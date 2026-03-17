from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import Event, Tournament
from app.schemas.event import EventCreate, EventRead, EventUpdate

router = APIRouter(prefix="/events", tags=["events"])


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


@router.get("/tournament/{tournament_id}/", response_model=list[EventRead])
def list_events(tournament_id: int, db: Session = Depends(get_db)):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")
    events = (
        db.query(Event)
        .filter(Event.tournament_id == tournament_id)
        .order_by(Event.division, Event.name)
        .all()
    )
    return [_serialize(e) for e in events]


@router.post("/", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def create_event(payload: EventCreate, db: Session = Depends(get_db)):
    tournament = db.query(Tournament).filter(Tournament.id == payload.tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    existing = db.query(Event).filter(
        Event.tournament_id == payload.tournament_id,
        Event.name == payload.name,
        Event.division == payload.division,
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Event '{payload.name}' division {payload.division} already exists in this tournament"
        )

    event = Event(**payload.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return _serialize(event)


@router.get("/{event_id}/", response_model=EventRead)
def get_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return _serialize(event)


@router.patch("/{event_id}/", response_model=EventRead)
def update_event(event_id: int, payload: EventUpdate, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    return _serialize(event)


@router.delete("/{event_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(event)
    db.commit()