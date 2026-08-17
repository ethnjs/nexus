from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.auth import require_admin
from app.db.session import get_db
from app.models.models import SeasonEvent, User
from app.schemas.season_event import SeasonEventCreate, SeasonEventRead, SeasonEventUpdate

# GET is public/unauthenticated, matching the canonical Event/EventCategory
# split (app/api/routes/events.py) — writes are admin-only, under /admin/.
router = APIRouter(prefix="/season-events", tags=["season-events"])
admin_router = APIRouter(prefix="/admin/season-events", tags=["season-events"])


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
    query = db.query(SeasonEvent).options(joinedload(SeasonEvent.event))
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
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A season event for this event/year/division already exists",
        )
    db.refresh(season_event)
    return season_event


# ---------------------------------------------------------------------------
# PATCH /admin/season-events/{id}/ — admin only, primarily used to toggle is_active
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

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(season_event, field, value)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A season event for this event/year/division already exists",
        )
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
