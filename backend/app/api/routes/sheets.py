from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.permissions import MANAGE_TOURNAMENT, require_permission
from app.db.session import get_db
from app.models.models import SheetConfig, Tournament, User
from app.schemas.sheet_config import (
    SheetConfigCreate,
    SheetConfigRead,
    SheetConfigUpdate,
    SheetHeadersRequest,
    SheetHeadersResponse,
    SheetValidateRequest,
    SheetValidateResponse,
    SyncResult,
)
from app.services.sheets_service import SheetsService
from app.services.sync_service import sync_sheet
from app.services.validation import validate_column_mappings

# Tournament-scoped routes nested under /tournaments/{tournament_id}/sheets/...
# All sheet config routes require manage_tournament.
router = APIRouter(prefix="/tournaments/{tournament_id}/sheets", tags=["sheets"])


def get_sheets_service() -> SheetsService:
    return SheetsService()


def _get_config_or_404(config_id: int, tournament_id: int, db: Session) -> SheetConfig:
    """Fetch config and validate it belongs to the given tournament."""
    config = db.query(SheetConfig).filter(SheetConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet config not found")
    if config.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet config not found")
    return config


def _validate_or_422(mappings: dict) -> None:
    """
    Run validate_column_mappings and raise HTTP 422 with structured body if
    there are hard errors. Warnings are not raised — callers may choose to
    include them in the response separately in future.
    """
    result = validate_column_mappings(mappings)
    if not result.ok:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=result.to_response_dict(),
        )


# ---------------------------------------------------------------------------
# Wizard step 1 — Validate URL and return available tabs
# ---------------------------------------------------------------------------
@router.post("/validate/", response_model=SheetValidateResponse)
def validate_sheet(
    tournament_id: int,
    payload: SheetValidateRequest,
    svc: SheetsService = Depends(get_sheets_service),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    """
    Given a Google Sheets URL, return the spreadsheet title and list of tabs.
    Called when the user pastes a URL in the wizard.
    """
    try:
        return svc.validate_sheet_url(payload.sheet_url)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ---------------------------------------------------------------------------
# Wizard step 2 — Fetch headers from a specific tab
# ---------------------------------------------------------------------------
@router.post("/headers/", response_model=SheetHeadersResponse)
def get_sheet_headers(
    tournament_id: int,
    payload: SheetHeadersRequest,
    svc: SheetsService = Depends(get_sheets_service),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    """
    Given a URL + sheet name, return the column headers and auto-detected
    field mapping suggestions.
    """
    try:
        return svc.get_headers(payload.sheet_url, payload.sheet_name)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ---------------------------------------------------------------------------
# Wizard step 3 — Save the finalized column mapping
# ---------------------------------------------------------------------------
@router.post("/configs/", response_model=SheetConfigRead, status_code=status.HTTP_201_CREATED)
def create_sheet_config(
    tournament_id: int,
    payload: SheetConfigCreate,
    db: Session = Depends(get_db),
    svc: SheetsService = Depends(get_sheets_service),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    """Save a completed column mapping for a tournament."""
    if payload.tournament_id != tournament_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tournament_id in body does not match URL",
        )

    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    serialized_mappings = {
        header: mapping.model_dump(exclude_none=True)
        for header, mapping in payload.column_mappings.items()
    }

    _validate_or_422(serialized_mappings)

    spreadsheet_id = svc.extract_spreadsheet_id(payload.sheet_url)

    config = SheetConfig(
        tournament_id=tournament_id,
        label=payload.label,
        sheet_type=payload.sheet_type,
        sheet_url=payload.sheet_url,
        spreadsheet_id=spreadsheet_id,
        sheet_name=payload.sheet_name,
        column_mappings=serialized_mappings,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


# ---------------------------------------------------------------------------
# GET /configs/ — list all configs for a tournament
# ---------------------------------------------------------------------------
@router.get("/configs/", response_model=list[SheetConfigRead])
def list_sheet_configs(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    """List all sheet configs for a given tournament."""
    return (
        db.query(SheetConfig)
        .filter(SheetConfig.tournament_id == tournament_id)
        .order_by(SheetConfig.created_at.desc())
        .all()
    )


# ---------------------------------------------------------------------------
# GET /configs/{config_id}/
# ---------------------------------------------------------------------------
@router.get("/configs/{config_id}/", response_model=SheetConfigRead)
def get_sheet_config(
    tournament_id: int,
    config_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    return _get_config_or_404(config_id, tournament_id, db)


# ---------------------------------------------------------------------------
# PATCH /configs/{config_id}/
# ---------------------------------------------------------------------------
@router.patch("/configs/{config_id}/", response_model=SheetConfigRead)
def update_sheet_config(
    tournament_id: int,
    config_id: int,
    payload: SheetConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    """Update label, sheet_name, column_mappings, or is_active."""
    config = _get_config_or_404(config_id, tournament_id, db)

    update_data = payload.model_dump(exclude_none=True)

    # Merge incoming column_mappings into existing ones rather than replacing
    if "column_mappings" in update_data and payload.column_mappings:
        merged = dict(config.column_mappings or {})
        merged.update({
            header: mapping.model_dump(exclude_none=True)
            for header, mapping in payload.column_mappings.items()
        })
        update_data["column_mappings"] = merged

    # Validate the full merged mappings before saving
    if "column_mappings" in update_data:
        _validate_or_422(update_data["column_mappings"])

    for field, value in update_data.items():
        setattr(config, field, value)

    db.commit()
    db.refresh(config)
    return config


# ---------------------------------------------------------------------------
# DELETE /configs/{config_id}/
# ---------------------------------------------------------------------------
@router.delete("/configs/{config_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_sheet_config(
    tournament_id: int,
    config_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    config = _get_config_or_404(config_id, tournament_id, db)
    db.delete(config)
    db.commit()


# ---------------------------------------------------------------------------
# POST /configs/{config_id}/sync/
# ---------------------------------------------------------------------------
@router.post("/configs/{config_id}/sync/", response_model=SyncResult)
def sync_sheet_config(
    tournament_id: int,
    config_id: int,
    db: Session = Depends(get_db),
    svc: SheetsService = Depends(get_sheets_service),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    """
    Sync all rows from a sheet into Users + Memberships.
    Full upsert — existing records are overwritten.
    Returns a summary of created, updated, skipped, and errors.
    """
    config = _get_config_or_404(config_id, tournament_id, db)

    if not config.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sheet config is not active",
        )

    try:
        return sync_sheet(config, db, svc)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))