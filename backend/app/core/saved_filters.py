from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.filter_conditions import ConditionCheck, validate_filter
from app.models.models import SavedFilter
from app.schemas.saved_filter import SavedFilterCreate, SavedFilterUpdate

_NAME_TAKEN = "A saved filter with this name already exists"


def _name_taken(
    db: Session,
    user_id: int,
    tournament_id: int | None,
    surface: str,
    name: str,
    *,
    excluding_id: int | None = None,
) -> bool:
    query = db.query(SavedFilter).filter(
        SavedFilter.user_id == user_id,
        SavedFilter.tournament_id.is_(None)
        if tournament_id is None
        else SavedFilter.tournament_id == tournament_id,
        SavedFilter.surface == surface,
        SavedFilter.name == name,
    )
    if excluding_id is not None:
        query = query.filter(SavedFilter.id != excluding_id)
    return query.first() is not None


def _commit(db: Session, saved: SavedFilter) -> None:
    # The unique constraint is the real guard; _name_taken just answers first.
    try:
        db.commit()
        db.refresh(saved)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NAME_TAKEN) from None


def list_saved_filters(
    db: Session, user_id: int, tournament_id: int | None, surface: str | None
) -> list[SavedFilter]:
    query = db.query(SavedFilter).filter(
        SavedFilter.user_id == user_id,
        SavedFilter.tournament_id.is_(None)
        if tournament_id is None
        else SavedFilter.tournament_id == tournament_id,
    )
    if surface is not None:
        query = query.filter(SavedFilter.surface == surface)
    return query.order_by(SavedFilter.name).all()


def get_saved_filter_or_404(
    db: Session, saved_id: int, user_id: int, tournament_id: int | None
) -> SavedFilter:
    """Another viewer's saved filter is a 404, so ids can't be probed."""
    saved = db.get(SavedFilter, saved_id)
    if saved is None or saved.user_id != user_id or saved.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved filter not found")
    return saved


def create_saved_filter(
    db: Session,
    user_id: int,
    tournament_id: int | None,
    payload: SavedFilterCreate,
    known_fields: frozenset[str],
    check: ConditionCheck | None = None,
) -> SavedFilter:
    validate_filter(payload.filter, known_fields, check)
    if _name_taken(db, user_id, tournament_id, payload.surface, payload.name):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NAME_TAKEN)
    saved = SavedFilter(
        user_id=user_id,
        tournament_id=tournament_id,
        surface=payload.surface,
        name=payload.name,
        filter=payload.filter.model_dump(),
    )
    db.add(saved)
    _commit(db, saved)
    return saved


def update_saved_filter(
    db: Session,
    saved: SavedFilter,
    payload: SavedFilterUpdate,
    known_fields: frozenset[str],
    check: ConditionCheck | None = None,
) -> SavedFilter:
    if payload.name is not None:
        if _name_taken(
            db,
            saved.user_id,
            saved.tournament_id,
            saved.surface,
            payload.name,
            excluding_id=saved.id,
        ):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NAME_TAKEN)
        saved.name = payload.name
    if payload.filter is not None:
        validate_filter(payload.filter, known_fields, check)
        saved.filter = payload.filter.model_dump()
    _commit(db, saved)
    return saved
