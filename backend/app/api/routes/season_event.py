from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.auth import require_admin
from app.db.session import get_db
from app.models.models import SEASON_FIELDS, Event, SeasonEvent, User
from app.schemas.season_event import SeasonEventCreate, SeasonEventRead, SeasonEventUpdate

# GET is public/unauthenticated, matching the canonical Event/EventCategory
# split (app/api/routes/events.py) — writes are admin-only, under /admin/.
router = APIRouter(prefix="/season-events", tags=["season-events"])
admin_router = APIRouter(prefix="/admin/season-events", tags=["season-events"])


def _sync_shared_fields(db: Session, season_event: SeasonEvent, sent: set[str]) -> None:
    """Keeps every division of an event in a season agreeing on SEASON_FIELDS:
    the ones this write sent are copied to the other divisions, and the rest
    are taken from them. Flushes, so a duplicate surfaces as IntegrityError."""
    db.flush()
    siblings = (
        db.query(SeasonEvent)
        .filter(
            SeasonEvent.event_id == season_event.event_id,
            SeasonEvent.year == season_event.year,
            SeasonEvent.id != season_event.id,
        )
        .all()
    )
    for field in SEASON_FIELDS:
        if field in sent:
            for sibling in siblings:
                setattr(sibling, field, getattr(season_event, field))
        elif siblings:
            setattr(season_event, field, getattr(siblings[0], field))


# ---------------------------------------------------------------------------
# GET /season-events/ — filterable by year, and by one or more divisions
# (repeat the query param, e.g. ?division=B&division=C)
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[SeasonEventRead])
def list_season_events(
    year: int | None = Query(None),
    division: list[str] | None = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(SeasonEvent).options(*Event.load_related_events(joinedload(SeasonEvent.event)))
    if year is not None:
        query = query.filter(SeasonEvent.year == year)
    if division:
        query = query.filter(SeasonEvent.division.in_(division))
    return query.order_by(SeasonEvent.year.desc(), SeasonEvent.division).all()


# ---------------------------------------------------------------------------
# POST /admin/season-events/ — admin only
# ---------------------------------------------------------------------------
@admin_router.post("/", response_model=SeasonEventRead, status_code=status.HTTP_201_CREATED)
def create_season_event(
    payload: SeasonEventCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    season_event = SeasonEvent(**payload.model_dump())
    db.add(season_event)
    try:
        _sync_shared_fields(db, season_event, payload.model_fields_set)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A season event for this event/year/division already exists",
        ) from None
    db.refresh(season_event)
    return season_event


# ---------------------------------------------------------------------------
# PATCH /admin/season-events/{id}/ — admin only
# ---------------------------------------------------------------------------
@admin_router.patch("/{season_event_id}/", response_model=SeasonEventRead)
def update_season_event(
    season_event_id: int,
    payload: SeasonEventUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    season_event = db.get(SeasonEvent, season_event_id)
    if not season_event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season event not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(season_event, field, value)

    try:
        _sync_shared_fields(db, season_event, set(update_data))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A season event for this event/year/division already exists",
        ) from None
    db.refresh(season_event)
    return season_event


# ---------------------------------------------------------------------------
# DELETE /admin/season-events/{id}/ — admin only
# ---------------------------------------------------------------------------
@admin_router.delete("/{season_event_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_season_event(
    season_event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    season_event = db.get(SeasonEvent, season_event_id)
    if not season_event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season event not found")

    db.delete(season_event)
    db.commit()
