from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.permissions import (
    MANAGE_EVENTS,
    MANAGE_TOURNAMENT,
    VIEW_EVENTS,
    require_membership,
    require_permission,
    has_permission,
)
from app.db.session import get_db
from app.models.models import Event, Tournament, User
from app.schemas.event import EventCreate, EventRead, EventUpdate

# Routes are nested: /tournaments/{tournament_id}/events/...
# tournament_id is always present in the path, which drives the permission check.
router = APIRouter(prefix="/tournaments/{tournament_id}/events", tags=["events"])


def _serialize(event: Event) -> dict:
    return {
        "id": event.id,
        "tournament_id": event.tournament_id,
        "name": event.name,
        "division": event.division,
        "event_type": event.event_type,
        "category": event.category,
        "building": event.building,
        "room": event.room,
        "floor": event.floor,
        "volunteers_needed": event.volunteers_needed,
        "blocks": event.blocks or [],
        "created_at": event.created_at,
        "updated_at": event.updated_at,
    }


def _get_event_or_404(event_id: int, tournament_id: int, db: Session) -> Event:
    """
    Fetch event by ID and validate it belongs to the given tournament.
    Returns 404 if not found or tournament mismatch — prevents cross-tournament access.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if event.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


def _require_write_permission(user: User, tournament_id: int, db: Session) -> None:
    """Raises 403 unless user has manage_events or manage_tournament."""
    if not (
        has_permission(user, tournament_id, MANAGE_EVENTS, db)
        or has_permission(user, tournament_id, MANAGE_TOURNAMENT, db)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/events/ — view_events or manage_events
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[EventRead])
def list_events(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(VIEW_EVENTS)),
):
    """List all events for a tournament, ordered by division then name."""
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    events = (
        db.query(Event)
        .filter(Event.tournament_id == tournament_id)
        .order_by(Event.division, Event.name)
        .all()
    )
    return [_serialize(e) for e in events]


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/events/{event_id} — view_events or manage_events
# ---------------------------------------------------------------------------
@router.get("/{event_id}/", response_model=EventRead)
def get_event(
    tournament_id: int,
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(VIEW_EVENTS)),
):
    return _serialize(_get_event_or_404(event_id, tournament_id, db))


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/events/ — manage_events or manage_tournament
# ---------------------------------------------------------------------------
@router.post("/", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def create_event(
    tournament_id: int,
    payload: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_write_permission(current_user, tournament_id, db)

    # Validate tournament_id in body matches path
    if payload.tournament_id != tournament_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tournament_id in body does not match URL",
        )

    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    existing = db.query(Event).filter(
        Event.tournament_id == tournament_id,
        Event.name == payload.name,
        Event.division == payload.division,
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Event '{payload.name}' division {payload.division} already exists in this tournament",
        )

    event = Event(**payload.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return _serialize(event)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/events/{event_id} — manage_events or manage_tournament
# ---------------------------------------------------------------------------
@router.patch("/{event_id}/", response_model=EventRead)
def update_event(
    tournament_id: int,
    event_id: int,
    payload: EventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_write_permission(current_user, tournament_id, db)
    event = _get_event_or_404(event_id, tournament_id, db)

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(event, field, value)

    db.commit()
    db.refresh(event)
    return _serialize(event)


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/events/{event_id} — manage_events or manage_tournament
# ---------------------------------------------------------------------------
@router.delete("/{event_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    tournament_id: int,
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_write_permission(current_user, tournament_id, db)
    event = _get_event_or_404(event_id, tournament_id, db)
    db.delete(event)
    db.commit()