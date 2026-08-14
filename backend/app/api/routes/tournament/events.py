from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.permissions import MANAGE_EVENTS, require_permission
from app.db.session import get_db
from app.models.models import SeasonEvent, TournamentEvent, TournamentShift, User
from app.schemas.tournament.event import (
    EventCreate, EventLoadDefaultsResponse, EventLoadDefaultsSkipped, EventRead, EventUpdate,
)

# Routes are nested: /tournaments/{tournament_id}/events/...
# tournament_id is always present in the path, which drives the permission check.
router = APIRouter(prefix="/tournaments/{tournament_id}/events", tags=["tournaments"])


def _validate_division(division: str | None, tournament) -> None:
    """A set division must be one of the divisions the tournament itself
    supports. SeasonEvent plays no role here — it's independent of what's
    "suggested" for the tournament."""
    if division is not None and division not in (tournament.division or []):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"division must be one of the tournament's divisions: {tournament.division}",
        )


def _validate_tournament_bounds(event: TournamentEvent, tournament) -> None:
    """start_time/end_time are nullable (planning starts before per-event
    times are known), so only bound whichever ones are set."""
    if event.start_time is not None and event.start_time.date() < tournament.start_date:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Event start_time falls before the tournament's start_date",
        )
    if event.end_time is not None and event.end_time.date() > tournament.end_date:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Event end_time falls after the tournament's end_date",
        )


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/events/ — manage_events
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[EventRead])
def list_events(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    """List all events for a tournament, ordered by division then name."""
    get_tournament(tournament_id, db)

    events = (
        db.query(TournamentEvent)
        .options(
            joinedload(TournamentEvent.event),
            joinedload(TournamentEvent.shifts).joinedload(TournamentShift.tournament_events),
        )
        .filter(TournamentEvent.tournament_id == tournament_id)
        .order_by(TournamentEvent.division, TournamentEvent.name)
        .all()
    )
    return events


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/events/{event_id} — manage_events
# ---------------------------------------------------------------------------
@router.get("/{event_id}/", response_model=EventRead)
def get_event(
    tournament_id: int,
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    return get_scoped_or_404(db, TournamentEvent, event_id, tournament_id, "Event")


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/events/ — manage_events
# ---------------------------------------------------------------------------
@router.post("/", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def create_event(
    tournament_id: int,
    payload: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    # Validate tournament_id in body matches path
    if payload.tournament_id != tournament_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tournament_id in body does not match URL",
        )

    _validate_division(payload.division, tournament)

    event = TournamentEvent(**payload.model_dump())
    _validate_tournament_bounds(event, tournament)
    db.add(event)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This catalog event already exists in this tournament for this division",
        )
    db.refresh(event)
    return event


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/events/{event_id} — manage_events
# ---------------------------------------------------------------------------
@router.patch("/{event_id}/", response_model=EventRead)
def update_event(
    tournament_id: int,
    event_id: int,
    payload: EventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    event = get_scoped_or_404(db, TournamentEvent, event_id, tournament_id, "Event")

    update_data = payload.model_dump(exclude_unset=True)
    if "division" in update_data:
        _validate_division(update_data["division"], tournament)

    for field, value in update_data.items():
        setattr(event, field, value)

    _validate_tournament_bounds(event, tournament)

    if event.name is None and event.event_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot clear both name and event_id — at least one must be set",
        )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This catalog event already exists in this tournament for this division",
        )
    db.refresh(event)
    return event


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/events/{event_id} — manage_events
# ---------------------------------------------------------------------------
@router.delete("/{event_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    tournament_id: int,
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    event = get_scoped_or_404(db, TournamentEvent, event_id, tournament_id, "Event")
    db.delete(event)
    db.commit()


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/events/load-defaults/ — manage_events
# Bulk-creates TournamentEvent rows from every active SeasonEvent whose
# division the tournament supports. 
# ---------------------------------------------------------------------------
@router.post("/load-defaults/", response_model=EventLoadDefaultsResponse, status_code=status.HTTP_201_CREATED)
def load_default_events(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    active_season_events = (
        db.query(SeasonEvent)
        .options(joinedload(SeasonEvent.event))
        .filter(
            SeasonEvent.is_active.is_(True),
            SeasonEvent.division.in_(tournament.division or []),
        )
        .all()
    )

    existing_pairs = {
        (te.event_id, te.division)
        for te in db.query(TournamentEvent).filter(
            TournamentEvent.tournament_id == tournament_id,
            TournamentEvent.event_id.isnot(None),
        )
    }

    created: list[TournamentEvent] = []
    skipped: list[EventLoadDefaultsSkipped] = []
    seen_pairs: set[tuple[int, str]] = set()

    for season_event in active_season_events:
        key = (season_event.event_id, season_event.division)
        if key in existing_pairs or key in seen_pairs:
            skipped.append(EventLoadDefaultsSkipped(
                event_id=season_event.event_id,
                division=season_event.division,
                name=season_event.event.name,
            ))
            continue
        seen_pairs.add(key)

        event = TournamentEvent(
            tournament_id=tournament_id,
            event_id=season_event.event_id,
            division=season_event.division,
            name=season_event.event.name,
        )
        db.add(event)
        created.append(event)

    db.commit()
    for event in created:
        db.refresh(event)

    return EventLoadDefaultsResponse(created=created, skipped=skipped)
