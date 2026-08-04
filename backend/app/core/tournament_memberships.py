from sqlalchemy.orm import Session

from app.models.models import TournamentMembership


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
