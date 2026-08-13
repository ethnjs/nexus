from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.permissions import MANAGE_EVENTS, require_permission
from app.db.session import get_db
from app.models.models import TournamentEvent, User
from app.schemas.tournament.event import EventCreate, EventRead, EventUpdate

# Routes are nested: /tournaments/{tournament_id}/events/...
# tournament_id is always present in the path, which drives the permission check.
router = APIRouter(prefix="/tournaments/{tournament_id}/events", tags=["tournaments"])


def _serialize(event: TournamentEvent) -> dict:
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
        .filter(TournamentEvent.tournament_id == tournament_id)
        .order_by(TournamentEvent.division, TournamentEvent.name)
        .all()
    )
    return [_serialize(e) for e in events]


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
    return _serialize(get_scoped_or_404(db, TournamentEvent, event_id, tournament_id, "Event"))


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

    existing = db.query(TournamentEvent).filter(
        TournamentEvent.tournament_id == tournament_id,
        TournamentEvent.name == payload.name,
        TournamentEvent.division == payload.division,
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Event '{payload.name}' division {payload.division} already exists in this tournament",
        )

    event = TournamentEvent(**payload.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return _serialize(event)


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

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(event, field, value)

    db.commit()
    db.refresh(event)
    return _serialize(event)


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