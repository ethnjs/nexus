from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.models import TournamentMembership, User
from app.schemas.tournament.membership import MembershipSlimResponse
from app.schemas.user import UserSlimResponse

def get_membership_by_user(db: Session, tournament_id: int, user_id: int, *options) -> TournamentMembership | None:
    """
    Fetch a membership by (tournament_id, user_id) rather than by membership
    id — the .../memberships/me/ routes' lookup shape. Nullable, not a 404
    helper: callers that must 404 on a missing row do that themselves
    (get_my_membership's GET route instead synthesizes a response for the
    admin-without-a-row case).
    """
    query = db.query(TournamentMembership).filter(
        TournamentMembership.tournament_id == tournament_id,
        TournamentMembership.user_id == user_id,
    )
    if options:
        query = query.options(*options)
    return query.first()

def resolve_memberships_or_users(
    db: Session, tournament_id: int, user_ids: set[int],
) -> dict[int, MembershipSlimResponse | UserSlimResponse]:
    """
    Resolve a batch of user ids to their TournamentMembership in this
    tournament, falling back to the bare User for ids with no membership row
    (e.g. a site admin acting without ever joining). Shared by any response
    that surfaces "who did this" — join-code creators, audit log actors.
    """
    memberships = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == tournament_id,
            TournamentMembership.user_id.in_(user_ids),
        )
        .all()
    )
    resolved: dict[int, MembershipSlimResponse | UserSlimResponse] = {
        m.user_id: MembershipSlimResponse.model_validate(m) for m in memberships
    }
    missing_ids = user_ids - resolved.keys()
    if missing_ids:
        users = db.query(User).filter(User.id.in_(missing_ids)).all()
        resolved.update({u.id: UserSlimResponse.model_validate(u) for u in users})
    return resolved


def has_any_membership(user: "User", tournament_id: int, db: Session) -> bool:
    """Return True if the user has any membership in `tournament_id`."""
    if user.role == "admin":
        return True
    return get_membership_by_user(db, tournament_id, user.id) is not None


def mark_confirmed(db: Session, membership_id: int) -> TournamentMembership:
    """
    Mark a TournamentMembership as confirmed. Meant to be called by the
    eventual confirmation-form submission handler (forms system, not yet
    built) — status doesn't gate role/event assignment, this just records
    that the member confirmed their participation.
    """
    membership = db.query(TournamentMembership).filter(TournamentMembership.id == membership_id).first()
    if membership is None:
        raise ValueError(f"TournamentMembership {membership_id} not found")

    membership.status = "confirmed"
    db.commit()
    db.refresh(membership)
    return membership
