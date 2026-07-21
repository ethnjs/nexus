from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.db.session import get_db
from app.models.models import Event, EventCategory, User
from app.core.auth import require_admin
from app.schemas.event import (
    EventResponse, EventCreate, EventUpdate,
    EventCategoryResponse, EventCategoryCreate, EventCategoryUpdate,
)

router = APIRouter(tags=["events"])


# ---------------------------------------------------------------------------
# GET /events/ — list all events
# ---------------------------------------------------------------------------
@router.get("/events/", response_model=list[EventResponse])
def list_events(db: Session = Depends(get_db)):
    return db.query(Event).all()


# ---------------------------------------------------------------------------
# POST /events/ — admin only, create a new event
# ---------------------------------------------------------------------------
@router.post("/events/", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(body: EventCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    category = db.get(EventCategory, body.category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    event = Event(name=body.name, category_id=body.category_id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


# ---------------------------------------------------------------------------
# PATCH /events/{id}/ — admin only, partial update
# ---------------------------------------------------------------------------
@router.patch("/events/{event_id}/", response_model=EventResponse)
def update_event(event_id: int, body: EventUpdate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    data = body.model_dump(exclude_unset=True)

    if "category_id" in data:
        category = db.get(EventCategory, data["category_id"])
        if not category:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    for field, value in data.items():
        setattr(event, field, value)

    db.commit()
    db.refresh(event)
    return event


# ---------------------------------------------------------------------------
# DELETE /events/{id}/ — admin only, hard delete blocked if experience entries exist
# ---------------------------------------------------------------------------
@router.delete("/events/{event_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    db.delete(event)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete event: it has associated competition or volunteer experience entries",
        )


# ---------------------------------------------------------------------------
# GET /event-categories/ — list all event categories
# ---------------------------------------------------------------------------
@router.get("/event-categories/", response_model=list[EventCategoryResponse])
def list_event_categories(db: Session = Depends(get_db)):
    return db.query(EventCategory).all()


# ---------------------------------------------------------------------------
# POST /event-categories/ — admin only, create a new category
# ---------------------------------------------------------------------------
@router.post("/event-categories/", response_model=EventCategoryResponse, status_code=status.HTTP_201_CREATED)
def create_event_category(body: EventCategoryCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    category = EventCategory(name=body.name)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


# ---------------------------------------------------------------------------
# PATCH /event-categories/{id}/ — admin only, partial update
# ---------------------------------------------------------------------------
@router.patch("/event-categories/{category_id}/", response_model=EventCategoryResponse)
def update_event_category(
    category_id: int,
    body: EventCategoryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    category = db.get(EventCategory, category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(category, field, value)

    db.commit()
    db.refresh(category)
    return category


# ---------------------------------------------------------------------------
# DELETE /event-categories/{id}/ — admin only, cascades to delete its events
# (blocked if any of those events has experience entries — see delete_event note)
# ---------------------------------------------------------------------------
@router.delete("/event-categories/{category_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_event_category(category_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    category = db.get(EventCategory, category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    db.delete(category)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete category: one or more of its events has associated experience entries",
        )