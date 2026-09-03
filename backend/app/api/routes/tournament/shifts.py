from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.core.form import shift_referenced_by_live_field
from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived, tournament_local_date
from app.core.tournament.permissions import MANAGE_EVENTS, require_catalog_read, require_permission
from app.db.session import get_db
from app.models.models import TournamentEvent, TournamentEventShift, TournamentShift, User
from app.schemas.tournament.shift import TournamentShiftCreate, TournamentShiftRead, TournamentShiftUpdate

# Routes are nested: /tournaments/{tournament_id}/shifts/...
router = APIRouter(prefix="/tournaments/{tournament_id}/shifts", tags=["tournaments"])


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/shifts/ — manage_events, or any member
# with ?public=true
#
# Same shape either way for now: a shift is a label and a time range, and any
# member who has answered an availability question has already seen those
# resolved into its options. The param still exists so the member-facing read
# is explicit at the call site rather than an accident of permissions.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[TournamentShiftRead])
def list_shifts(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_catalog_read(MANAGE_EVENTS)),
):
    get_tournament(tournament_id, db)
    return (
        db.query(TournamentShift)
        .options(selectinload(TournamentShift.tournament_events))
        .filter(TournamentShift.tournament_id == tournament_id)
        .order_by(TournamentShift.start)
        .all()
    )


def _validate_tournament_bounds(shift: TournamentShift, tournament) -> None:
    """Compared in the tournament's own timezone — start_date/end_date are
    naive local dates, not UTC ones."""
    if tournament_local_date(tournament, shift.start) < tournament.start_date:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Shift start falls before the tournament's start_date",
        )
    if tournament_local_date(tournament, shift.end) > tournament.end_date:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Shift end falls after the tournament's end_date",
        )


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/shifts/ — manage_events
# ---------------------------------------------------------------------------
@router.post("/", response_model=TournamentShiftRead, status_code=status.HTTP_201_CREATED)
def create_shift(
    tournament_id: int,
    payload: TournamentShiftCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    shift = TournamentShift(tournament_id=tournament_id, **payload.model_dump())
    _validate_tournament_bounds(shift, tournament)
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return shift


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/shifts/{shift_id}/ — manage_events
# ---------------------------------------------------------------------------
@router.patch("/{shift_id}/", response_model=TournamentShiftRead)
def update_shift(
    tournament_id: int,
    shift_id: int,
    payload: TournamentShiftUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    shift = get_scoped_or_404(db, TournamentShift, shift_id, tournament_id, "Shift")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(shift, field, value)

    _validate_tournament_bounds(shift, tournament)

    db.commit()
    db.refresh(shift)
    return shift


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/shifts/{shift_id}/ — manage_events
# Event references are not a guard — deletion cascades through
# tournament_event_shifts (ondelete="CASCADE"), silently detaching from any
# events it was attached to. Intentionally different from how TimeBlock
# deletion worked in the old scrapped design.
#
# Membership availability *is* a hard guard, unlike events — it's
# member-submitted data (write-through from a form response, see
# app/core/form/write_through.py), not planning structure a TD can just
# re-derive, so silently cascading it away on a shift edit isn't acceptable.
#
# A live (non-archived) availability field's option grouping is the same
# kind of guard, even before anyone's answered: a shift that's part of a
# published question's choices can't be silently pulled out from under it.
# ---------------------------------------------------------------------------
@router.delete("/{shift_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_shift(
    tournament_id: int,
    shift_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    shift = get_scoped_or_404(db, TournamentShift, shift_id, tournament_id, "Shift")

    if shift.availability_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Shift has {shift.availability_count} membership availability selection(s) — cannot delete",
        )

    if shift_referenced_by_live_field(db, tournament_id, shift_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Shift is referenced by a live form field's availability option — cannot delete",
        )

    db.delete(shift)
    db.commit()


# ---------------------------------------------------------------------------
# Shift attachment — a sub-resource of events, so nested under
# /tournaments/{tournament_id}/events/{event_id}/shifts/. Single attach/detach
# endpoints per shift (not a batch add/remove like membership roles) because
# each attach carries its own bounds/overlap validation with a specific 409
# reason — a batch call would need per-item partial failure reporting that
# isn't worth the complexity here.
# ---------------------------------------------------------------------------
event_shifts_router = APIRouter(
    prefix="/tournaments/{tournament_id}/events/{event_id}/shifts",
    tags=["tournaments"],
)


def _validate_attach(event: TournamentEvent, shift: TournamentShift, db: Session) -> None:
    if event.start_time is None or event.end_time is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Event must have both a start_time and end_time before shifts can be attached",
        )

    if shift.start < event.start_time or shift.end > event.end_time:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Shift must fall entirely within the event's start/end time",
        )

    attached = (
        db.query(TournamentShift)
        .join(TournamentEventShift, TournamentEventShift.tournament_shift_id == TournamentShift.id)
        .filter(
            TournamentEventShift.tournament_event_id == event.id,
            TournamentShift.id != shift.id,
        )
        .all()
    )
    for other in attached:
        # Adjacent (end == start) is fine — only strict overlap is rejected.
        if shift.start < other.end and shift.end > other.start:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Shift overlaps another shift already attached to this event ('{other.label}')",
            )


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/events/{event_id}/shifts/{shift_id}/ — manage_events
# ---------------------------------------------------------------------------
@event_shifts_router.post("/{shift_id}/", response_model=TournamentShiftRead, status_code=status.HTTP_201_CREATED)
def attach_shift(
    tournament_id: int,
    event_id: int,
    shift_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    event = get_scoped_or_404(db, TournamentEvent, event_id, tournament_id, "Event")
    shift = get_scoped_or_404(db, TournamentShift, shift_id, tournament_id, "Shift")

    already_attached = (
        db.query(TournamentEventShift)
        .filter(
            TournamentEventShift.tournament_event_id == event.id,
            TournamentEventShift.tournament_shift_id == shift.id,
        )
        .first()
    )
    if already_attached:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Shift already attached to this event")

    _validate_attach(event, shift, db)

    db.add(TournamentEventShift(tournament_event_id=event.id, tournament_shift_id=shift.id))
    db.commit()
    db.refresh(shift)
    return shift


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/events/{event_id}/shifts/{shift_id}/ — manage_events
# ---------------------------------------------------------------------------
@event_shifts_router.delete("/{shift_id}/", status_code=status.HTTP_204_NO_CONTENT)
def detach_shift(
    tournament_id: int,
    event_id: int,
    shift_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    event = get_scoped_or_404(db, TournamentEvent, event_id, tournament_id, "Event")
    shift = get_scoped_or_404(db, TournamentShift, shift_id, tournament_id, "Shift")

    bridge = (
        db.query(TournamentEventShift)
        .filter(
            TournamentEventShift.tournament_event_id == event.id,
            TournamentEventShift.tournament_shift_id == shift.id,
        )
        .first()
    )
    if not bridge:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not attached to this event")

    db.delete(bridge)
    db.commit()
