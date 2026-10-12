from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.tournament import get_scoped_or_404, get_tournament
from app.core.tournament.permissions import MANAGE_MEMBERS, require_permission
from app.db.session import get_db
from app.models.models import TournamentExportPreset, User
from app.schemas.tournament.export_preset import (
    ExportPresetColumn, ExportPresetCreate, ExportPresetRead, ExportPresetSort,
    ExportPresetUpdate, validate_sorts_against_columns,
)


# Saved custom exports (#110). Shared tournament-wide and edited in place by
# anyone with MANAGE_MEMBERS — the gate on the roster every export reads.
# No archive check and no audit entries: like display config, a preset is a
# way of reading the data, not the data.
router = APIRouter(prefix="/tournaments/{tournament_id}/export-presets", tags=["tournaments"])

_NAME_TAKEN = "An export preset with this name already exists"


def _name_taken(db: Session, tournament_id: int, name: str, *, excluding_id: int | None = None) -> bool:
    query = db.query(TournamentExportPreset).filter(
        TournamentExportPreset.tournament_id == tournament_id,
        TournamentExportPreset.name == name,
    )
    if excluding_id is not None:
        query = query.filter(TournamentExportPreset.id != excluding_id)
    return query.first() is not None


def _check_sorts(sorts: list[ExportPresetSort], columns: list[ExportPresetColumn]) -> None:
    try:
        validate_sorts_against_columns(sorts, columns)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


def _commit(db: Session, preset: TournamentExportPreset) -> None:
    # The unique constraint is the real guard; _name_taken just answers first.
    try:
        db.commit()
        db.refresh(preset)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NAME_TAKEN)


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/export-presets/ — manage_members
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[ExportPresetRead])
def list_export_presets(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    get_tournament(tournament_id, db)
    return (
        db.query(TournamentExportPreset)
        .filter(TournamentExportPreset.tournament_id == tournament_id)
        .order_by(TournamentExportPreset.name)
        .all()
    )


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/export-presets/ — manage_members
# ---------------------------------------------------------------------------
@router.post("/", response_model=ExportPresetRead, status_code=status.HTTP_201_CREATED)
def create_export_preset(
    tournament_id: int,
    payload: ExportPresetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    get_tournament(tournament_id, db)
    _check_sorts(payload.sorts, payload.columns)
    if _name_taken(db, tournament_id, payload.name):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NAME_TAKEN)

    preset = TournamentExportPreset(
        tournament_id=tournament_id, created_by=current_user.id, **payload.model_dump(exclude_none=True),
    )
    db.add(preset)
    _commit(db, preset)
    return preset


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/export-presets/{preset_id}/ — manage_members
# ---------------------------------------------------------------------------
@router.patch("/{preset_id}/", response_model=ExportPresetRead)
def update_export_preset(
    tournament_id: int,
    preset_id: int,
    payload: ExportPresetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    get_tournament(tournament_id, db)
    preset = get_scoped_or_404(db, TournamentExportPreset, preset_id, tournament_id, "Export preset")

    # Null means "not sent" for every field; none of them can be cleared to null.
    updates = payload.model_dump(exclude_none=True)
    if "name" in updates and _name_taken(db, tournament_id, updates["name"], excluding_id=preset.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NAME_TAKEN)

    # Either half may arrive alone, so check the merged result.
    if payload.sorts is not None or payload.columns is not None:
        columns = payload.columns if payload.columns is not None else [
            ExportPresetColumn.model_construct(**column) for column in preset.columns
        ]
        sorts = payload.sorts if payload.sorts is not None else [
            ExportPresetSort.model_construct(**sort) for sort in preset.sorts
        ]
        _check_sorts(sorts, columns)

    for field, value in updates.items():
        setattr(preset, field, value)
    _commit(db, preset)
    return preset


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/export-presets/{preset_id}/ — manage_members
# ---------------------------------------------------------------------------
@router.delete("/{preset_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_export_preset(
    tournament_id: int,
    preset_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    get_tournament(tournament_id, db)
    preset = get_scoped_or_404(db, TournamentExportPreset, preset_id, tournament_id, "Export preset")
    db.delete(preset)
    db.commit()
