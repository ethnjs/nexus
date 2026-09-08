from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.assignments import resolve_membership_role, validate_shift_on_event
from app.core.tournament.audit import (
    ASSIGNMENT_CREATED, ASSIGNMENT_DELETED, ASSIGNMENT_UPDATED, log_action,
)
from app.core.tournament.permissions import (
    MANAGE_EVENTS, MANAGE_MEMBERS, require_any_permission, require_permission,
)
from app.db.session import get_db
from app.models.models import (
    TournamentEvent, TournamentEventAssignment, TournamentMembership,
    TournamentMembershipRole, TournamentRole, User,
)
from app.schemas.tournament.assignment import AssignmentCreate, AssignmentRead, AssignmentUpdate

# Flat under the tournament, not nested under either parent: an assignment
# joins an event to a member, and the board that writes these drags between
# the two. Nesting it under one would make the other a body field for no
# reason and imply an ownership that isn't there.
router = APIRouter(prefix="/tournaments/{tournament_id}/assignments", tags=["tournaments"])


def _with_relations(query):
    """The four hops every AssignmentRead flattens. Applied to reads as well as
    to the row a write returns — without them each response is an N+1 through
    lazy loads that pydantic triggers one row at a time."""
    return query.options(
        joinedload(TournamentEventAssignment.tournament_event).joinedload(TournamentEvent.event),
        # EventMemberRead now carries the event's shifts, so the nested event
        # needs them loaded or every assignment costs a query for them.
        joinedload(TournamentEventAssignment.tournament_event).selectinload(TournamentEvent.shifts),
        joinedload(TournamentEventAssignment.membership).joinedload(TournamentMembership.user),
        joinedload(TournamentEventAssignment.membership_role).joinedload(TournamentMembershipRole.role),
        joinedload(TournamentEventAssignment.tournament_shift),
    )


def _flush_or_conflict(db: Session) -> None:
    """Turn the partial unique indexes into a 409 instead of a 500.

    Uniqueness is enforced in the database rather than by a pre-check, which
    is the right call — a check-then-insert races. The cost is that the
    violation surfaces as an IntegrityError, and a duplicate drag on the board
    is an ordinary thing for a TD to do, not a server fault.

    Guards the flush, not the commit: the INSERT is what trips the index, and
    it is emitted at flush time so log_action can reference the new row's id.
    """
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This member is already assigned to that event in that role and shift",
        )


def _audit_data(assignment: TournamentEventAssignment, role_granted: bool = False) -> dict:
    return {
        "event_id": assignment.tournament_event_id,
        "membership_id": assignment.membership_id,
        "role_id": assignment.membership_role.role_id,
        "shift_id": assignment.tournament_shift_id,
        "role_granted": role_granted,
    }


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/assignments/ — manage_events OR manage_members
#
# Looser than the writes below on purpose: who is staffing an event is part of
# reading the event, while deciding who staffs it is member data. See the
# MANAGE_EVENTS/MANAGE_MEMBERS split in core/tournament/permissions.py.
#
# Both filters are optional and compose — the board reads the whole tournament,
# a member panel reads one person, an event drawer reads one event. That's a
# query parameter, not three routes.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[AssignmentRead])
def list_assignments(
    tournament_id: int,
    event_id: int | None = Query(default=None),
    membership_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_permission(MANAGE_EVENTS, MANAGE_MEMBERS)),
):
    get_tournament(tournament_id, db)

    query = _with_relations(
        db.query(TournamentEventAssignment)
        .join(TournamentEvent, TournamentEventAssignment.tournament_event_id == TournamentEvent.id)
        .filter(TournamentEvent.tournament_id == tournament_id)
    )
    if event_id is not None:
        query = query.filter(TournamentEventAssignment.tournament_event_id == event_id)
    if membership_id is not None:
        query = query.filter(TournamentEventAssignment.membership_id == membership_id)

    rows = query.order_by(TournamentEventAssignment.id).all()
    return [AssignmentRead.from_row(row) for row in rows]


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/assignments/ — manage_members
#
# The body names a role, not the member's join row. If they don't hold it yet
# this grants it first (rank-bound — see resolve_membership_role), so staffing
# someone as a Test Writer is one action rather than a detour through the
# roster.
#
# Nothing here checks whether the member is available, confirmed on the track,
# or already booked at that hour. Those are warnings the board renders, never
# refusals — see core/tournament/assignments.py.
# ---------------------------------------------------------------------------
@router.post("/", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED)
def create_assignment(
    tournament_id: int,
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    event = get_scoped_or_404(
        db, TournamentEvent, payload.tournament_event_id, tournament_id, "Event",
    )
    membership = get_scoped_or_404(
        db, TournamentMembership, payload.membership_id, tournament_id, "Membership",
    )
    role = get_scoped_or_404(db, TournamentRole, payload.role_id, tournament_id, "Role")

    validate_shift_on_event(db, event, payload.tournament_shift_id, tournament_id)

    held_before = {mr.role_id for mr in membership.roles}
    membership_role = resolve_membership_role(db, tournament, membership, role, current_user)

    assignment = TournamentEventAssignment(
        tournament_event_id=event.id,
        membership_id=membership.id,
        membership_role_id=membership_role.id,
        tournament_shift_id=payload.tournament_shift_id,
    )
    db.add(assignment)
    _flush_or_conflict(db)

    log_action(
        db, tournament_id, current_user.id, ASSIGNMENT_CREATED,
        target_type="assignment", target_id=assignment.id,
        extra_data=_audit_data(assignment, role_granted=role.id not in held_before),
    )
    db.commit()

    return AssignmentRead.from_row(
        _with_relations(db.query(TournamentEventAssignment)).filter_by(id=assignment.id).one()
    )


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/assignments/{assignment_id}/ — manage_members
#
# `tournament_shift_id` is nullable *and* optional, which are different things:
# omitting it leaves the shift alone, sending an explicit null clears it. The
# type can't express that, so this reads model_fields_set — the only way to
# tell "don't touch" from "unset it" on a nullable field.
# ---------------------------------------------------------------------------
@router.patch("/{assignment_id}/", response_model=AssignmentRead)
def update_assignment(
    tournament_id: int,
    assignment_id: int,
    payload: AssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    assignment = _scoped_assignment(db, assignment_id, tournament_id)
    role_granted = False

    if payload.role_id is not None:
        role = get_scoped_or_404(db, TournamentRole, payload.role_id, tournament_id, "Role")
        membership = assignment.membership
        held_before = {mr.role_id for mr in membership.roles}
        membership_role = resolve_membership_role(
            db, tournament, membership, role, current_user,
        )
        assignment.membership_role_id = membership_role.id
        role_granted = role.id not in held_before

    if "tournament_shift_id" in payload.model_fields_set:
        validate_shift_on_event(
            db, assignment.tournament_event, payload.tournament_shift_id, tournament_id,
        )
        assignment.tournament_shift_id = payload.tournament_shift_id

    _flush_or_conflict(db)
    log_action(
        db, tournament_id, current_user.id, ASSIGNMENT_UPDATED,
        target_type="assignment", target_id=assignment.id,
        extra_data=_audit_data(assignment, role_granted=role_granted),
    )
    db.commit()

    return AssignmentRead.from_row(
        _with_relations(db.query(TournamentEventAssignment)).filter_by(id=assignment.id).one()
    )


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/assignments/{assignment_id}/ — manage_members
#
# Unassigning never removes the role the assignment used. The grant was a fact
# about the member, not a detail of this one placement, and revoking it here
# would quietly undo staffing on every other event they hold it for.
# ---------------------------------------------------------------------------
@router.delete("/{assignment_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(
    tournament_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    assignment = _scoped_assignment(db, assignment_id, tournament_id)

    log_action(
        db, tournament_id, current_user.id, ASSIGNMENT_DELETED,
        target_type="assignment", target_id=assignment.id,
        extra_data=_audit_data(assignment),
    )
    db.delete(assignment)
    db.commit()


def _scoped_assignment(
    db: Session, assignment_id: int, tournament_id: int,
) -> TournamentEventAssignment:
    """get_scoped_or_404 can't be reused here: it scopes on the row's own
    tournament_id column, and an assignment has none — it reaches its
    tournament through the event. Same 404-on-either-miss behaviour, so a
    cross-tournament id is indistinguishable from a missing one."""
    assignment = (
        _with_relations(db.query(TournamentEventAssignment))
        .join(TournamentEvent, TournamentEventAssignment.tournament_event_id == TournamentEvent.id)
        .filter(
            TournamentEventAssignment.id == assignment_id,
            TournamentEvent.tournament_id == tournament_id,
        )
        .first()
    )
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return assignment
