from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.tournament.memberships import ACTIVE_MEMBERSHIP_CLAUSE
from app.models.models import Form, FormResponse, TournamentForm, TournamentMembership, utcnow


@dataclass(frozen=True)
class OnboardingProgress:
    """The member's next required form, if any, in the active sequence."""

    next_form_id: str | None


def advance_onboarding_progress(
    db: Session,
    membership: TournamentMembership,
) -> OnboardingProgress:
    """Find the next unanswered published onboarding form and snapshot completion.

    This intentionally lives in the tournament-onboarding layer rather than
    the generic forms submission flow. A client calls the onboarding progress
    endpoint after submitting a form to learn where to go next.
    """
    next_form_id = next_required_onboarding_form_id(db, membership)
    if next_form_id is None and membership.onboarded_at is None:
        membership.onboarded_at = utcnow()

    return OnboardingProgress(next_form_id=next_form_id)


def _live_steps(db: Session, tournament_id: int) -> list[TournamentForm]:
    """The onboarding sequence members actually walk: a step that isn't
    published (draft, or archived) is skipped, not blocking."""
    return (
        db.query(TournamentForm)
        .join(Form, TournamentForm.form_id == Form.id)
        .filter(
            TournamentForm.tournament_id == tournament_id,
            TournamentForm.is_onboarding == True,
            Form.status == "published",
        )
        .order_by(TournamentForm.order)
        .all()
    )


def recompute_onboarding(db: Session, tournament_id: int) -> None:
    """Re-derive every active member's onboarded_at from the responses they
    already gave — call whenever the live sequence changes, so nobody waits on
    their next progress call to be (un)onboarded. Keeps an existing completion
    time. Does not commit."""
    # The session doesn't autoflush — without this the queries below would
    # read the sequence as it was before the caller's change.
    db.flush()
    required = {step.form_id for step in _live_steps(db, tournament_id)}
    answered: dict[int, set[str]] = {}
    if required:
        for user_id, form_id in (
            db.query(FormResponse.user_id, FormResponse.form_id)
            .filter(FormResponse.form_id.in_(required))
        ):
            answered.setdefault(user_id, set()).add(form_id)

    now = utcnow()
    for membership in db.query(TournamentMembership).filter(
        TournamentMembership.tournament_id == tournament_id, ACTIVE_MEMBERSHIP_CLAUSE,
    ):
        complete = required <= answered.get(membership.user_id, set())
        if complete and membership.onboarded_at is None:
            membership.onboarded_at = now
        elif not complete and membership.onboarded_at is not None:
            membership.onboarded_at = None


def next_required_onboarding_form_id(
    db: Session,
    membership: TournamentMembership,
) -> str | None:
    """Return the next unanswered published onboarding form without mutating state.

    Form access and the member overview need the exact same ordered answer as
    the progression endpoint, but merely reading either must not mark someone
    onboarded. ``advance_onboarding_progress`` owns that one write.
    """
    steps = _live_steps(db, membership.tournament_id)
    answered_form_ids = {
        form_id
        for (form_id,) in (
            db.query(FormResponse.form_id)
            .filter(
                FormResponse.user_id == membership.user_id,
                FormResponse.form_id.in_([step.form_id for step in steps]),
            )
            .all()
        )
    }

    next_step = next((step for step in steps if step.form_id not in answered_form_ids), None)
    return next_step.form_id if next_step else None
