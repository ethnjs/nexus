from sqlalchemy.orm import Session

from app.models.models import TournamentMembership

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
