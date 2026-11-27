from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.saved_filters import (
    create_saved_filter,
    get_saved_filter_or_404,
    list_saved_filters,
    update_saved_filter,
)
from app.core.tournament import get_tournament
from app.core.tournament.display_config import known_filter_keys, roster_check, surface_base
from app.core.tournament.memberships import get_membership_by_user
from app.core.tournament.permissions import (
    MANAGE_EVENTS,
    MANAGE_MEMBERS,
    require_any_permission,
)
from app.db.session import get_db
from app.models.models import User
from app.schemas.saved_filter import SavedFilterCreate, SavedFilterRead, SavedFilterUpdate

# The caller's own named filters on this tournament's tables. Same gate as
# display config, and likewise no archive check: a filter is a way of reading
# the data, not the data.
router = APIRouter(prefix="/tournaments/{tournament_id}/saved-filters", tags=["tournaments"])


def _filter_keys(surface: str) -> frozenset[str]:
    """A table's filter fields. Saved filters take the bare surface, never a
    tab, so one saved on Day 1 is offered on every tab."""
    keys = known_filter_keys(surface)
    if surface_base(surface) != surface or not keys:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown surface '{surface}'",
        )
    return keys


def _require_membership(db: Session, tournament_id: int, user: User) -> None:
    if not get_membership_by_user(db, tournament_id, user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Join this tournament to save filters",
        )


@router.get("/", response_model=list[SavedFilterRead])
def list_my_saved_filters(
    tournament_id: int,
    surface: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_permission(MANAGE_MEMBERS, MANAGE_EVENTS)),
):
    get_tournament(tournament_id, db)
    return list_saved_filters(db, current_user.id, tournament_id, surface)


@router.post("/", response_model=SavedFilterRead, status_code=status.HTTP_201_CREATED)
def create_my_saved_filter(
    tournament_id: int,
    payload: SavedFilterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_permission(MANAGE_MEMBERS, MANAGE_EVENTS)),
):
    get_tournament(tournament_id, db)
    _require_membership(db, tournament_id, current_user)
    keys = _filter_keys(payload.surface)
    return create_saved_filter(
        db, current_user.id, tournament_id, payload, keys, roster_check(payload.surface)
    )


@router.patch("/{saved_id}/", response_model=SavedFilterRead)
def update_my_saved_filter(
    tournament_id: int,
    saved_id: int,
    payload: SavedFilterUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_permission(MANAGE_MEMBERS, MANAGE_EVENTS)),
):
    get_tournament(tournament_id, db)
    saved = get_saved_filter_or_404(db, saved_id, current_user.id, tournament_id)
    return update_saved_filter(
        db, saved, payload, _filter_keys(saved.surface), roster_check(saved.surface)
    )


@router.delete("/{saved_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_saved_filter(
    tournament_id: int,
    saved_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_permission(MANAGE_MEMBERS, MANAGE_EVENTS)),
):
    get_tournament(tournament_id, db)
    db.delete(get_saved_filter_or_404(db, saved_id, current_user.id, tournament_id))
    db.commit()
