"""Resolution and validation for tournament event assignments.

Kept out of the route module because the events route needs
detach_shifts_from_assignments when a shift leaves an event.

The line this module holds is that **only structural errors raise**. An
assignment that contradicts what a member said about their availability, their
track status, or their existing commitments is legal and stays legal — the
board shows it as a warning. TDs override reality constantly, and a hard block
there makes the tool unusable (issue #70).
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.tournament import get_scoped_or_404
from app.core.tournament.roles import validate_role_action
from app.models.models import (
    Tournament, TournamentEvent, TournamentEventShift, TournamentMembership,
    TournamentRole, TournamentShift, TournamentTrack, TournamentTrackAssignment, User,
)


def authorize_role_grant(
    db: Session,
    tournament: Tournament,
    membership: TournamentMembership,
    role: TournamentRole,
    actor: User,
) -> None:
    """Check that `actor` may put `membership` in `role`, if this would be new.

    Replaces resolve_membership_role. There is no join row to resolve any
    more: since #83 the assignment row *is* the record that the member holds
    the role, so nothing has to be created first and nothing is returned.

    What survives is the guard. Staffing someone in a role they don't hold
    still grants it — that is what makes "assign Priya as a Test Writer" one
    action — and a grant is a real privilege change, so it goes through the
    same rank check the roles route uses: you cannot hand out a role that
    ties or outranks your own, and the owner's membership is untouchable.

    Skipped when the member already holds the role anywhere in the
    tournament. Re-staffing someone in a role they have held for weeks is not
    a grant, and making it re-run the rank check would stop a coordinator
    moving their own peers between events.
    """
    already_held = any(
        assignment.role_id == role.id for assignment in membership.track_assignments
    )
    if already_held:
        return
    validate_role_action(actor, tournament, membership, role, db)


def validate_shift_on_event(
    db: Session, event: TournamentEvent, shift_id: int | None, tournament_id: int,
) -> TournamentShift | None:
    """A shift must be one this event actually runs in.

    The one structural rule here. Assigning someone to a shift the event isn't
    attached to isn't an override of anything a member said — it's a statement
    about the schedule that the schedule contradicts, and nothing downstream
    could render it sensibly.

    `None` is always valid, including on an event that has shifts: it means
    "on this event, no particular shift", which is the only thing test writing
    can mean and a legitimate intermediate state elsewhere.

    Returns the shift it validated (None for an unpinned row), so a caller
    that also needs the track it falls on doesn't fetch it a second time.
    """
    if shift_id is None:
        return None

    shift = get_scoped_or_404(db, TournamentShift, shift_id, tournament_id, "Shift")
    attached = (
        db.query(TournamentEventShift)
        .filter_by(tournament_event_id=event.id, tournament_shift_id=shift.id)
        .first()
    )
    if attached is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"'{shift.label}' is not one of this event's shifts",
        )
    return shift


def resolve_assignment_track(
    db: Session,
    shift: TournamentShift | None,
    track_id: int | None,
    tournament_id: int,
) -> int:
    """Which track a row is for — always answered, never guessed.

    A pinned row's shift already carries it, and the database enforces the
    pair (see fk_assignment_shift_track), so the shift is taken as the answer
    rather than checked against whatever the caller sent alongside. Sending
    both and disagreeing is a confused client, not a second opinion, so it is
    rejected rather than silently resolved one way.

    An unpinned row has nothing else to go on, which is the whole reason the
    column exists: a cosmetic track has no shifts, so "Test Writing" was
    previously recoverable only by matching the row's role against each
    track's default — ambiguous whenever two tracks share one.
    """
    if shift is not None:
        if track_id is not None and track_id != shift.track_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"'{shift.label}' is not on the track this assignment names",
            )
        return shift.track_id

    if track_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="An assignment with no shift must name the track it is for",
        )
    get_scoped_or_404(db, TournamentTrack, track_id, tournament_id, "Track")
    return track_id


def detach_shifts_from_assignments(
    db: Session, event_id: int, shift_ids: set[int],
) -> int:
    """Null the shift on this event's assignments that pointed at one of
    `shift_ids`, returning how many were touched.

    Called when shifts leave an event. Without it those assignments keep
    naming a shift the event no longer runs — the row stays valid (the shift
    itself still exists) and nothing complains, so it reads as real staffing
    at a time that is no longer on the schedule.

    Nulling rather than deleting: a TD reshuffling a schedule is not saying
    the person is off the event. Losing staffing silently during a schedule
    edit is exactly the kind of thing nobody notices until the day.
    """
    if not shift_ids:
        return 0

    rows = (
        db.query(TournamentTrackAssignment)
        .filter(
            TournamentTrackAssignment.tournament_event_id == event_id,
            TournamentTrackAssignment.tournament_shift_id.in_(shift_ids),
        )
        .all()
    )
    for row in rows:
        row.tournament_shift_id = None
    return len(rows)
