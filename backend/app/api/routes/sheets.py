from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import SheetConfig, Tournament
from app.schemas.sheet_config import (
    SheetConfigCreate,
    SheetConfigRead,
    SheetConfigUpdate,
    SheetHeadersRequest,
    SheetHeadersResponse,
    SheetValidateRequest,
    SheetValidateResponse,
)
from app.services.sheets_service import SheetsService
from app.services.sync_service import sync_sheet
from app.schemas.sheet_config import SyncResult

router = APIRouter(prefix="/sheets", tags=["sheets"])


def get_sheets_service() -> SheetsService:
    return SheetsService()


# ---------------------------------------------------------------------------
# Wizard step 1 — Validate URL and return available tabs
# ---------------------------------------------------------------------------
@router.post("/validate", response_model=SheetValidateResponse)
def validate_sheet(
    payload: SheetValidateRequest,
    svc: SheetsService = Depends(get_sheets_service),
):
    """
    Given a Google Sheets URL, return the spreadsheet title and list of tabs.
    Called when the user pastes a URL in the wizard.
    """
    try:
        return svc.validate_sheet_url(payload.sheet_url)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Wizard step 2 — Fetch headers from a specific tab
# ---------------------------------------------------------------------------
@router.post("/headers", response_model=SheetHeadersResponse)
def get_sheet_headers(
    payload: SheetHeadersRequest,
    svc: SheetsService = Depends(get_sheets_service),
):
    """
    Given a URL + sheet name, return the column headers and auto-detected
    field mapping suggestions.
    """
    try:
        return svc.get_headers(payload.sheet_url, payload.sheet_name)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Wizard step 3 — Save the finalized column mapping
# ---------------------------------------------------------------------------
@router.post("/configs", response_model=SheetConfigRead, status_code=status.HTTP_201_CREATED)
def create_sheet_config(
    payload: SheetConfigCreate,
    db: Session = Depends(get_db),
    svc: SheetsService = Depends(get_sheets_service),
):
    """
    Save a completed column mapping for a tournament.
    Extracts and stores the spreadsheet_id from the URL.
    """
    tournament = db.query(Tournament).filter(Tournament.id == payload.tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    spreadsheet_id = svc.extract_spreadsheet_id(payload.sheet_url)

    # Serialize ColumnMapping objects to plain dicts for JSON storage
    serialized_mappings = {
        header: mapping.model_dump(exclude_none=True)
        for header, mapping in payload.column_mappings.items()
    }

    config = SheetConfig(
        tournament_id=payload.tournament_id,
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


@router.get("/configs/{config_id}", response_model=SheetConfigRead)
def get_sheet_config(config_id: int, db: Session = Depends(get_db)):
    config = db.query(SheetConfig).filter(SheetConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Sheet config not found")
    return config


@router.get("/configs/tournament/{tournament_id}", response_model=list[SheetConfigRead])
def list_sheet_configs(tournament_id: int, db: Session = Depends(get_db)):
    """List all sheet configs for a given tournament."""
    return (
        db.query(SheetConfig)
        .filter(SheetConfig.tournament_id == tournament_id)
        .order_by(SheetConfig.created_at.desc())
        .all()
    )


@router.patch("/configs/{config_id}", response_model=SheetConfigRead)
def update_sheet_config(
    config_id: int,
    payload: SheetConfigUpdate,
    db: Session = Depends(get_db),
):
    """Update label, sheet_name, column_mappings, or is_active."""
    config = db.query(SheetConfig).filter(SheetConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Sheet config not found")

    update_data = payload.model_dump(exclude_none=True)
    # Merge incoming column_mappings into existing ones rather than replacing
    if "column_mappings" in update_data and payload.column_mappings:
        merged = dict(config.column_mappings or {})
        merged.update({
            header: mapping.model_dump(exclude_none=True)
            for header, mapping in payload.column_mappings.items()
        })
        update_data["column_mappings"] = merged
    for field, value in update_data.items():
        setattr(config, field, value)

    db.commit()
    db.refresh(config)
    return config


@router.delete("/configs/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sheet_config(config_id: int, db: Session = Depends(get_db)):
    config = db.query(SheetConfig).filter(SheetConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Sheet config not found")
    db.delete(config)
    db.commit()


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------
@router.post("/configs/{config_id}/sync", response_model=SyncResult)
def sync_sheet_config(
    config_id: int,
    db: Session = Depends(get_db),
    svc: SheetsService = Depends(get_sheets_service),
):
    """
    Sync all rows from a sheet into Users + Memberships.
    Full upsert — existing records are overwritten.
    Returns a summary of created, updated, skipped, and errors.
    """
    config = db.query(SheetConfig).filter(SheetConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Sheet config not found")

    if not config.is_active:
        raise HTTPException(status_code=400, detail="Sheet config is not active")

    try:
        return sync_sheet(config, db, svc)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))