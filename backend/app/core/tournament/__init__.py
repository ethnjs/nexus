from __future__ import annotations
from collections.abc import Sequence
from datetime import datetime
from typing import TypeVar
from zoneinfo import ZoneInfo
from fastapi import Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.tournament.memberships import ACTIVE_MEMBERSHIP_CLAUSE
from app.db.session import get_db
from app.models.models import Tournament, TournamentEvent, TournamentMembership, User

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


def tournament_counts(db: Session, tournament_ids: Sequence[int]) -> dict[int, dict[str, int]]:
    """{tournament_id: {"event_count": n, "volunteer_count": n}} for the ids given.

    Two grouped queries for the whole list, not per row. The obvious
    `len(t.events)` / `sum(1 for m in t.memberships ...)` lazy-loads both full
    collections for every tournament in the list — tolerable for one user's
    handful of dashboard cards, an N+1 over every tournament on the platform.

    Ids with nothing to count are still present, at zero: a caller building a
    response shouldn't have to distinguish "no events" from "not in the dict".
    """
    counts: dict[int, dict[str, int]] = {
        tid: {"event_count": 0, "volunteer_count": 0} for tid in tournament_ids
    }
    if not counts:
        return counts

    ids = list(counts)

    # TournamentEvent, not Event: Event is the global canonical catalog and
    # has no tournament_id. Tournament.events points here.
    event_rows = (
        db.query(TournamentEvent.tournament_id, func.count(TournamentEvent.id))
        .filter(TournamentEvent.tournament_id.in_(ids))
        .group_by(TournamentEvent.tournament_id)
        .all()
    )
    for tournament_id, count in event_rows:
        counts[tournament_id]["event_count"] = count

    # Declined memberships are excluded, matching is_declined() — the row
    # still exists, it just isn't a volunteer.
    member_rows = (
        db.query(TournamentMembership.tournament_id, func.count(TournamentMembership.id))
        .filter(TournamentMembership.tournament_id.in_(ids), ACTIVE_MEMBERSHIP_CLAUSE)
        .group_by(TournamentMembership.tournament_id)
        .all()
    )
    for tournament_id, count in member_rows:
        counts[tournament_id]["volunteer_count"] = count

    return counts


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