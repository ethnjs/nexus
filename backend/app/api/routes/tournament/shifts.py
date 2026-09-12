from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, selectinload

from app.core.form import shift_referenced_by_live_field
from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived, tournament_local_date
from app.core.tournament.permissions import (
    MANAGE_EVENTS, require_membership, require_permission,
)
from app.core.tournament.tracks import purge_pending_tracks
from app.db.session import get_db
from app.models.models import (
    TournamentEvent, TournamentEventShift, TournamentShift, TournamentTrack, User,
)
from app.schemas.tournament.shift import TournamentShiftCreate, TournamentShiftRead, TournamentShiftUpdate

# Routes are nested: /tournaments/{tournament_id}/shifts/...
router = APIRouter(prefix="/tournaments/{tournament_id}/shifts", tags=["tournaments"])


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/shifts/ — any member.
#
# Not manage_events-gated: the member edit page needs the catalog to render
# its own availability, and a shift is only a label and a time range. Any
# member who has answered an availability question has already seen these
# resolved into its options. Writes below still require manage_events.
#
# ?track_id= narrows to one track's day, which is the unit availability is
# scoped to — see shift_ids_on_track.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[TournamentShiftRead])
def list_shifts(
    tournament_id: int,
    track_id: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_membership()),
):
    get_tournament(tournament_id, db)
    query = (
        db.query(TournamentShift)
        .options(selectinload(TournamentShift.tournament_events))
        .filter(TournamentShift.tournament_id == tournament_id)
    )
    if track_id is not None:
        query = query.filter(TournamentShift.track_id == track_id)
    return query.order_by(TournamentShift.start).all()


def _resolve_track(db: Session, tournament_id: int, track_id: int) -> TournamentTrack:
    """The track a shift is being placed on, rejected unless it can actually
    hold one. Only a primary track has dates, and a shift with no date range
    to sit inside is unvalidatable; a pending-delete track is on its way out,
    so adding a shift would only deepen the reference that blocks it."""
    track = get_scoped_or_404(db, TournamentTrack, track_id, tournament_id, "Track")
    if track.is_archived:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This track is pending deletion",
        )
    if not track.is_primary:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{track.name}' has no dates — only a primary track can hold shifts",
        )
    return track


def _validate_track_bounds(shift: TournamentShift, track: TournamentTrack, tournament) -> None:
    """A shift belongs to one track's day(s), so it's bounded by that track's
    own range rather than the tournament's. That distinction is the point of
    tracks: with Day 1 on Feb 13 and Day 2 on Feb 20, the tournament spans
    both, but a Day 1 shift on Feb 20 is a mistake.

    Compared in the tournament's own timezone — a track's start/end are naive
    local dates, not UTC ones."""
    if tournament_local_date(tournament, shift.start) < track.start_date:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Shift start falls before '{track.name}' begins",
        )
    if tournament_local_date(tournament, shift.end) > track.end_date:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Shift end falls after '{track.name}' ends",
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

    track = _resolve_track(db, tournament_id, payload.track_id)
    shift = TournamentShift(tournament_id=tournament_id, **payload.model_dump())
    _validate_track_bounds(shift, track, tournament)
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
    previous_track_id = shift.track_id

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(shift, field, value)

    track = _resolve_track(db, tournament_id, shift.track_id)
    _validate_track_bounds(shift, track, tournament)

    # Moving the shift off a track may have cleared the last reference
    # keeping a pending-delete track alive. Same transaction as the move, so a
    # failed edit can't purge a track as a side effect.
    if shift.track_id != previous_track_id:
        purge_pending_tracks(db, tournament_id, current_user.id)

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
    db.flush()
    # That may have been the track's last shift — see the PATCH above.
    purge_pending_tracks(db, tournament_id, current_user.id)
    db.commit()


# An event's shifts are set through the event itself (EventCreate/EventUpdate's
# shift_ids), not through attach/detach routes here. They're a property of the
# event, the same as its tracks — and the overlap check that used to live in
# _validate_attach moved with them, into events.py's _validate_no_overlap.
