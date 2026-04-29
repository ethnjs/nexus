from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.permissions import (
    MANAGE_EVENTS,
    VIEW_EVENTS,
    require_permission,
    has_permission,
)
from app.db.session import get_db
from app.models.models import Event, Tournament, User, TimeBlock, TournamentCategory
from app.schemas.event import EventCreate, EventRead, EventUpdate, EventBatchUpdate

# Routes are nested: /tournaments/{tournament_id}/events/...
# tournament_id is always present in the path, which drives the permission check.
router = APIRouter(prefix="/tournaments/{tournament_id}/events", tags=["events"])


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
    """Raises 403 unless user has manage_events permission."""
    if not has_permission(user, tournament_id, MANAGE_EVENTS, db):
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
    category_id: int | None = Query(None),
    division: str | None = Query(None),
    type: str | None = Query(None, alias="type"), # mapping "type" param to event_type
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(VIEW_EVENTS)),
):
    """List all events for a tournament, with optional filters."""
    query = db.query(Event).filter(Event.tournament_id == tournament_id)

    if category_id is not None:
        query = query.filter(Event.category_id == category_id)
    if division is not None:
        query = query.filter(Event.division == division)
    if type is not None:
        query = query.filter(Event.event_type == type)

    events = query.order_by(Event.division, Event.name).all()
    return events


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
    return _get_event_or_404(event_id, tournament_id, db)


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

    # Extract time_block_ids from payload
    data = payload.model_dump(exclude={"time_block_ids"})
    event = Event(**data)

    if payload.time_block_ids:
        blocks = (
            db.query(TimeBlock)
            .filter(
                TimeBlock.id.in_(payload.time_block_ids),
                TimeBlock.tournament_id == tournament_id,
            )
            .all()
        )
        event.time_blocks = blocks

    db.add(event)
    db.commit()
    db.refresh(event)
    return event


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/events/batch/ — manage_events or manage_tournament
# ---------------------------------------------------------------------------
@router.patch("/batch/", response_model=list[EventRead])
def batch_update_events(
    tournament_id: int,
    payload: EventBatchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Apply a partial update to multiple events in one request.

    Only keys present in `payload.updates` are written; absent keys are skipped.
    Returns the updated EventRead list in the same order as event_ids.
    """
    _require_write_permission(current_user, tournament_id, db)

    update_data = payload.updates.model_dump(exclude_none=True)
    time_block_ids = update_data.pop("time_block_ids", None)

    blocks = None
    if time_block_ids is not None:
        blocks = (
            db.query(TimeBlock)
            .filter(
                TimeBlock.id.in_(time_block_ids),
                TimeBlock.tournament_id == tournament_id,
            )
            .all()
        )

    updated: list[Event] = []
    for event_id in payload.event_ids:
        event = _get_event_or_404(event_id, tournament_id, db)
        for field, value in update_data.items():
            setattr(event, field, value)
        if blocks is not None:
            event.time_blocks = blocks
        updated.append(event)

    db.commit()
    for event in updated:
        db.refresh(event)
    return updated


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

    for field in payload.model_fields_set - {"time_block_ids"}:
        setattr(event, field, getattr(payload, field))

    if payload.time_block_ids is not None:
        blocks = (
            db.query(TimeBlock)
            .filter(
                TimeBlock.id.in_(payload.time_block_ids),
                TimeBlock.tournament_id == tournament_id,
            )
            .all()
        )
        event.time_blocks = blocks

    db.commit()
    db.refresh(event)
    return event


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
