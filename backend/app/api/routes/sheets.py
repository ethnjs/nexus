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

    config = SheetConfig(
        tournament_id=payload.tournament_id,
        label=payload.label,
        sheet_type=payload.sheet_type,
        sheet_url=payload.sheet_url,
        spreadsheet_id=spreadsheet_id,
        sheet_name=payload.sheet_name,
        column_mappings=payload.column_mappings,
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

    for field, value in payload.model_dump(exclude_none=True).items():
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