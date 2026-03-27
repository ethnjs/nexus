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
    ValidateMappingsRequest,
    ValidateMappingsResponse,
    SyncResult,
)
from app.services.sheets_service import SheetsService
from app.services.forms_service import FormsService
from app.services.sync_service import sync_sheet
from app.services.sheets_validation import validate_column_mappings, ValidationResult

# Tournament-scoped routes nested under /tournaments/{tournament_id}/sheets/...
# All sheet config routes require manage_tournament.
router = APIRouter(prefix="/tournaments/{tournament_id}/sheets", tags=["sheets"])


def get_sheets_service() -> SheetsService:
    return SheetsService()


def get_forms_service() -> FormsService:
    return FormsService()


def _get_config_or_404(config_id: int, tournament_id: int, db: Session) -> SheetConfig:
    """Fetch config and validate it belongs to the given tournament."""
    config = db.query(SheetConfig).filter(SheetConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet config not found")
    if config.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet config not found")
    return config


def _validate_or_422(mappings: dict) -> ValidationResult:
    """
    Run validate_column_mappings and raise HTTP 422 with structured body if
    there are hard errors. Returns the ValidationResult so callers can include
    warnings in successful responses.
    """
    result = validate_column_mappings(mappings)
    if not result.ok:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=result.to_response_dict(),
        )
    return result


def _warnings_from_result(result: ValidationResult) -> list[dict]:
    """Serialise ValidationResult warnings to a list of dicts for the response."""
    return [
        {
            "header": (
                i.header if isinstance(i.header, list)
                else [i.header] if i.header is not None
                else None
            ),
            "rule_index": i.rule_index,
            "message": i.message,
        }
        for i in result.warnings
    ]


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
    try:
        return svc.validate_sheet_url(payload.sheet_url)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ---------------------------------------------------------------------------
# Wizard steps 2 & 3 — Fetch headers (tab select) + form questions (form URL)
# ---------------------------------------------------------------------------
@router.post("/headers/", response_model=SheetHeadersResponse)
def get_sheet_headers(
    tournament_id: int,
    payload: SheetHeadersRequest,
    svc: SheetsService = Depends(get_sheets_service),
    forms_svc: FormsService = Depends(get_forms_service),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    try:
        # Fetch form questions when a form URL is provided (volunteers sheets).
        # FormsService errors surface as the same 403/400 shape as SheetsService.
        form_questions = None
        if payload.form_url:
            form_questions = forms_svc.get_form_questions(payload.form_url)

        return svc.get_headers(
            sheet_url=payload.sheet_url,
            sheet_name=payload.sheet_name,
            sheet_type=payload.sheet_type,
            form_questions=form_questions,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ---------------------------------------------------------------------------
# Validate mappings — run validation without saving
# ---------------------------------------------------------------------------
@router.post("/configs/validate-mappings/", response_model=ValidateMappingsResponse)
def validate_mappings(
    tournament_id: int,
    payload: ValidateMappingsRequest,
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    """
    Validate column mappings without saving. Returns errors and warnings.
    Call before createConfig or updateConfig so the frontend can surface
    issues inline before committing any DB write.
    """
    serialized = {
        header: mapping.model_dump(exclude_none=True)
        for header, mapping in payload.column_mappings.items()
    }
    result = validate_column_mappings(serialized)
    response = result.to_response_dict()
    return ValidateMappingsResponse(
        ok=result.ok,
        errors=response["errors"],
        warnings=response["warnings"],
    )


# ---------------------------------------------------------------------------
# Wizard step 4 — Save the finalized column mapping
# ---------------------------------------------------------------------------
@router.post(
    "/configs/",
    response_model=SheetConfigReadWithWarnings,
    status_code=status.HTTP_201_CREATED,
)
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

    validation = _validate_or_422(serialized_mappings)

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

    return SheetConfigReadWithWarnings(
        **SheetConfigRead.model_validate(config).model_dump(),
        warnings=_warnings_from_result(validation),
    )


# ---------------------------------------------------------------------------
# GET /configs/ — list all configs for a tournament
# ---------------------------------------------------------------------------
@router.get("/configs/", response_model=list[SheetConfigRead])
def list_sheet_configs(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
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
@router.patch("/configs/{config_id}/", response_model=SheetConfigReadWithWarnings)
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
    validation = ValidationResult()  # default empty (no warnings) if no mappings to validate
    if "column_mappings" in update_data:
        validation = _validate_or_422(update_data["column_mappings"])

    for field, value in update_data.items():
        setattr(config, field, value)

    db.commit()
    db.refresh(config)

    return SheetConfigReadWithWarnings(
        **SheetConfigRead.model_validate(config).model_dump(),
        warnings=_warnings_from_result(validation),
    )


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