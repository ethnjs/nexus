from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

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
    steps = (
        db.query(TournamentForm)
        .join(Form, TournamentForm.form_id == Form.id)
        .filter(
            TournamentForm.tournament_id == membership.tournament_id,
            TournamentForm.is_onboarding == True,
            Form.status == "published",
        )
        .order_by(TournamentForm.order)
        .all()
    )
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
    if next_step is None and membership.onboarded_at is None:
        membership.onboarded_at = utcnow()

    return OnboardingProgress(next_form_id=next_step.form_id if next_step else None)
