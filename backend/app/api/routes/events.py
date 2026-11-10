from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.db.session import get_db
from app.models.models import Event, EventCategory, EventRelationship, User
from app.schemas.event import (
    EventCategoryCreate,
    EventCategoryResponse,
    EventCategoryUpdate,
    EventCreate,
    EventRelationshipCreate,
    EventResponse,
    EventUpdate,
)

router = APIRouter(tags=["events"])

# Admin-only writes live under /admin/, matching app/api/routes/tournament/admin.py
# and app/api/routes/season_event.py — the public GET routes above stay
# unprefixed and unauthenticated.
admin_router = APIRouter(prefix="/admin", tags=["events"])


# ---------------------------------------------------------------------------
# GET /events/ — list all events
# ---------------------------------------------------------------------------
@router.get("/events/", response_model=list[EventResponse])
def list_events(db: Session = Depends(get_db)):
    return db.query(Event).options(*Event.load_related_events()).all()


# ---------------------------------------------------------------------------
# POST /admin/events/ — admin only, create a new event
# ---------------------------------------------------------------------------
@admin_router.post("/events/", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(
    body: EventCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)
):
    category = db.get(EventCategory, body.category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    event = Event(name=body.name, category_id=body.category_id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


# ---------------------------------------------------------------------------
# PATCH /admin/events/{id}/ — admin only, partial update
# ---------------------------------------------------------------------------
@admin_router.patch("/events/{event_id}/", response_model=EventResponse)
def update_event(
    event_id: int,
    body: EventUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
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
# DELETE /admin/events/{id}/ — admin only, hard delete blocked if experience entries exist
# ---------------------------------------------------------------------------
@admin_router.delete("/events/{event_id}/", status_code=status.HTTP_204_NO_CONTENT)
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
        ) from None


# ---------------------------------------------------------------------------
# POST /admin/events/{id}/related/ — admin only, relate two events
# ---------------------------------------------------------------------------
@admin_router.post(
    "/events/{event_id}/related/", response_model=EventResponse, status_code=status.HTTP_201_CREATED
)
def add_related_event(
    event_id: int,
    body: EventRelationshipCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Relates two catalog events. Relationships go both ways, so the related
    event lists this one too."""
    if body.related_event_id == event_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="An event can't be related to itself",
        )
    event = db.get(Event, event_id)
    if not event or not db.get(Event, body.related_event_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    low, high = sorted((event_id, body.related_event_id))
    db.add(EventRelationship(event_id=low, related_event_id=high))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="These events are already related"
        ) from None
    db.refresh(event)
    return event


# ---------------------------------------------------------------------------
# DELETE /admin/events/{id}/related/{related_id}/ — admin only
# ---------------------------------------------------------------------------
@admin_router.delete("/events/{event_id}/related/{related_event_id}/", response_model=EventResponse)
def remove_related_event(
    event_id: int,
    related_event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Removes a relationship from both events."""
    low, high = sorted((event_id, related_event_id))
    relationship = (
        db.query(EventRelationship)
        .filter(EventRelationship.event_id == low, EventRelationship.related_event_id == high)
        .first()
    )
    if not relationship:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="These events aren't related"
        )
    db.delete(relationship)
    db.commit()
    event = db.get(Event, event_id)
    db.refresh(event)
    return event


# ---------------------------------------------------------------------------
# GET /event-categories/ — list all event categories
# ---------------------------------------------------------------------------
@router.get("/event-categories/", response_model=list[EventCategoryResponse])
def list_event_categories(db: Session = Depends(get_db)):
    return db.query(EventCategory).all()


# ---------------------------------------------------------------------------
# POST /admin/event-categories/ — admin only, create a new category
# ---------------------------------------------------------------------------
@admin_router.post(
    "/event-categories/", response_model=EventCategoryResponse, status_code=status.HTTP_201_CREATED
)
def create_event_category(
    body: EventCategoryCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)
):
    category = EventCategory(name=body.name)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


# ---------------------------------------------------------------------------
# PATCH /admin/event-categories/{id}/ — admin only, partial update
# ---------------------------------------------------------------------------
@admin_router.patch("/event-categories/{category_id}/", response_model=EventCategoryResponse)
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
# DELETE /admin/event-categories/{id}/ — admin only, cascades to delete its events
# (blocked if any of those events has experience entries — see delete_event note)
# ---------------------------------------------------------------------------
@admin_router.delete("/event-categories/{category_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_event_category(
    category_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)
):
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
        ) from None
