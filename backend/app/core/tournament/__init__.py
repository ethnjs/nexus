from __future__ import annotations
from datetime import datetime
from typing import TypeVar
from zoneinfo import ZoneInfo
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.models.models import Tournament, TournamentMembership, User

T = TypeVar("T")


def tournament_local_date(tournament: Tournament, moment: datetime):
    """Convert a tz-aware UTC instant to the calendar date it falls on in
    the tournament's own timezone — start_date/end_date are naive dates
    with no timezone of their own, so any comparison against them needs to
    go through the tournament's timezone first, not a bare `.date()` on
    the UTC value (which drifts a day off near midnight for any tz other
    than UTC)."""
    return moment.astimezone(ZoneInfo(tournament.timezone)).date()


def get_scoped_or_404(db: Session, model: type[T], id_: int, tournament_id: int, label: str) -> T:
    """
    Fetch a row by id, scoped to tournament_id via its own tournament_id
    column. 404s on either a missing row or a tournament mismatch — the two
    are indistinguishable to the caller, which also prevents cross-tournament
    ID probing. Shared by every {event,join-code,membership,role} lookup.
    """
    obj = db.query(model).filter(model.id == id_).first()
    if not obj or getattr(obj, "tournament_id", None) != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    return obj


def get_tournament(tournament_id: int, db: Session = Depends(get_db)) -> Tournament:
    """Fetch the tournament identified by the tournament_id path param, or 404."""
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return tournament


def tournament_display_name(tournament: Tournament) -> str:
    """"{year} {short_name or name}" — e.g. "2026 SoCal States" or "2026 Southern California
    State Tournament" when no short_name is set. Year comes from
    the tournament's first day (the name itself excludes it, see
    TournamentCreate.name), which is derived from the primary tracks — the year
    drops off entirely on the transient case where none of them has dates
    yet."""
    label = tournament.short_name or tournament.name
    return f"{tournament.first_day.year} {label}" if tournament.first_day else label


def require_not_archived(tournament: Tournament) -> None:
    """
    Call explicitly in every POST/PATCH/DELETE route, right after fetching
    the tournament via get_tournament() — archived tournaments stay fully
    readable, so this isn't baked into get_tournament itself or into
    require_permission()/require_membership(), both of which also gate GETs.
    """
    if tournament.is_archived:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This tournament is archived and cannot be modified.",
        )