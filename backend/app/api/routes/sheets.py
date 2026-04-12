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
    SheetConfigReadWithWarnings,
    SheetConfigUpdate,
    SheetHeadersRequest,
    SheetHeadersResponse,
    SheetValidateRequest,
    SheetValidateResponse,
    SyncResult,
    ValidateMappingsRequest,
    ValidateMappingsResponse,
)
from app.services.sheets_service import SheetsService
from app.services.forms_service import FormsService
from app.services.sync_service import sync_sheet
from app.services.sheets_validation import validate_column_mappings

router = APIRouter(prefix="/tournaments/{tournament_id}/sheets", tags=["sheets"])


def get_sheets_service() -> SheetsService:
    return SheetsService()


def get_forms_service() -> FormsService:
    return FormsService()


def _get_config_or_404(config_id: int, tournament_id: int, db: Session) -> SheetConfig:
    config = db.query(SheetConfig).filter(SheetConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet config not found")
    if config.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet config not found")
    return config


def _validate_or_422(column_mappings: list[dict]) -> list[dict]:
    result = validate_column_mappings(column_mappings)
    if not result.ok:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=result.to_response_dict(),
        )
    return result.warnings


# ---------------------------------------------------------------------------
# Wizard step 1 — Validate URL
# ---------------------------------------------------------------------------
@router.post("/validate/", response_model=SheetValidateResponse)
def validate_sheet(
    tournament_id: int,
    payload: SheetValidateRequest,
    svc: SheetsService = Depends(get_sheets_service),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    try:
        return svc.validate_sheet_url(payload.sheet_url)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ---------------------------------------------------------------------------
# Wizard step 2 — Fetch headers
# ---------------------------------------------------------------------------
@router.post("/headers/", response_model=SheetHeadersResponse)
def get_sheet_headers(
    tournament_id: int,
    payload: SheetHeadersRequest,
    svc: SheetsService = Depends(get_sheets_service),
    forms_svc: FormsService = Depends(get_forms_service),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    form_questions = None
    if payload.form_url:
        try:
            form_questions = forms_svc.get_form_questions(payload.form_url)
        except PermissionError as e:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    try:
        return svc.get_headers(
            payload.sheet_url,
            payload.sheet_name,
            sheet_type=payload.sheet_type,
            form_questions=form_questions,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ---------------------------------------------------------------------------
# Validate mappings without saving
# ---------------------------------------------------------------------------
@router.post("/configs/validate-mappings/", response_model=ValidateMappingsResponse)
def validate_mappings(
    tournament_id: int,
    payload: ValidateMappingsRequest,
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    result = validate_column_mappings(payload.column_mappings)
    return result.to_response_dict()


# ---------------------------------------------------------------------------
# Sheet config CRUD
# ---------------------------------------------------------------------------
@router.get("/configs/", response_model=list[SheetConfigRead])
def list_sheet_configs(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    return db.query(SheetConfig).filter(SheetConfig.tournament_id == tournament_id).all()


@router.post("/configs/", response_model=SheetConfigReadWithWarnings, status_code=status.HTTP_201_CREATED)
def create_sheet_config(
    tournament_id: int,
    payload: SheetConfigCreate,
    db: Session = Depends(get_db),
    svc: SheetsService = Depends(get_sheets_service),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    raw_mappings = [m.model_dump() for m in payload.column_mappings]
    warnings = _validate_or_422(raw_mappings)

    spreadsheet_id = svc.extract_spreadsheet_id(payload.sheet_url)

    config = SheetConfig(
        tournament_id=tournament_id,
        label=payload.label,
        sheet_type=payload.sheet_type,
        sheet_url=payload.sheet_url,
        spreadsheet_id=spreadsheet_id,
        sheet_name=payload.sheet_name,
        column_mappings=raw_mappings,
    )
    db.add(config)
    db.commit()
    db.refresh(config)

    response = SheetConfigReadWithWarnings.model_validate(config)
    response.warnings = [w.__dict__ if hasattr(w, "__dict__") else w for w in warnings]
    return response


@router.get("/configs/{config_id}/", response_model=SheetConfigRead)
def get_sheet_config(
    tournament_id: int,
    config_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    return _get_config_or_404(config_id, tournament_id, db)


@router.patch("/configs/{config_id}/", response_model=SheetConfigReadWithWarnings)
def update_sheet_config(
    tournament_id: int,
    config_id: int,
    payload: SheetConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    config = _get_config_or_404(config_id, tournament_id, db)

    if payload.label is not None:
        config.label = payload.label
    if payload.sheet_type is not None:
        config.sheet_type = payload.sheet_type
    if payload.sheet_name is not None:
        config.sheet_name = payload.sheet_name
    if payload.is_active is not None:
        config.is_active = payload.is_active
    if payload.column_mappings is not None:
        raw_mappings = [m.model_dump() for m in payload.column_mappings]
        warnings = _validate_or_422(raw_mappings)
        existing_list = config.column_mappings or []
        by_index: dict[int, dict] = {}

        for m in existing_list:
            md = m.model_dump(exclude_none=True) if hasattr(m, "model_dump") else dict(m)
            by_index[int(md.get("column_index", -1))] = md
        for m in raw_mappings:
            by_index[int(m.get("column_index", -1))] = m

        merged = [by_index[i] for i in sorted(by_index.keys()) if i >= 0]
        config.column_mappings = merged
    else:
        warnings = []

    db.commit()
    db.refresh(config)

    response = SheetConfigReadWithWarnings.model_validate(config)
    response.warnings = [w.__dict__ if hasattr(w, "__dict__") else w for w in warnings]
    return response


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
# Sync
# ---------------------------------------------------------------------------
@router.post("/configs/{config_id}/sync/", response_model=SyncResult)
def sync_sheet_config(
    tournament_id: int,
    config_id: int,
    db: Session = Depends(get_db),
    svc: SheetsService = Depends(get_sheets_service),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    config = _get_config_or_404(config_id, tournament_id, db)

    if not config.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sheet config is not active",
        )

    try:
        return sync_sheet(config, db, svc)  # fixed arg order: config, db, sheets_svc
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
