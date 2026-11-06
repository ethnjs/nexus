"""One member's form flow, as a manager previews it: the onboarding steps in
order and every other form, with what the member can do about each."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.tournament.form_prerequisites import meets_prerequisites
from app.core.tournament.onboarding import exempt_from_onboarding, onboarding_paths
from app.core.tournament.permissions import get_user_permissions
from app.models.models import (
    Form,
    FormResponse,
    TournamentForm,
    TournamentMembership,
    TournamentTrackAssignment,
)


@dataclass(frozen=True)
class FlowStep:
    form_id: str
    name: str
    status: str
    completed: bool
    # Onboarding: on this member's path. Other forms: their roles pass the prerequisites.
    applies: bool


@dataclass(frozen=True)
class MemberFormFlow:
    exempt_from_onboarding: bool
    # Still owes a published onboarding step, so other forms wait.
    held_to_onboarding: bool
    onboarding: list[FlowStep]
    forms: list[FlowStep]


def member_form_flow(db: Session, membership: TournamentMembership) -> MemberFormFlow:
    """Drafts are included so the TD sees where they'll land once published."""
    rows = (
        db.query(TournamentForm)
        .join(Form, TournamentForm.form_id == Form.id)
        .filter(TournamentForm.tournament_id == membership.tournament_id)
        .order_by(TournamentForm.order, Form.name)
        .all()
    )
    completed = {
        form_id
        for (form_id,) in db.query(FormResponse.form_id).filter(
            FormResponse.user_id == membership.user_id,
            FormResponse.form_id.in_([row.form_id for row in rows]),
        )
    }
    role_ids = {
        role_id
        for (role_id,) in db.query(TournamentTrackAssignment.role_id).filter(
            TournamentTrackAssignment.membership_id == membership.id
        )
    }
    path = onboarding_paths(
        db, membership.tournament_id, [membership.user_id], include_drafts=True
    )[membership.user_id]
    on_path = {step.form_id for step in path}

    exempt = exempt_from_onboarding(
        membership, get_user_permissions(membership.user, membership.tournament_id, db)
    )
    owes_step = any(step.status == "published" and not step.completed for step in path)

    def step(row: TournamentForm, applies: bool) -> FlowStep:
        return FlowStep(
            form_id=row.form_id,
            name=row.form.name,
            status=row.form.status,
            completed=row.form_id in completed,
            applies=applies,
        )

    return MemberFormFlow(
        exempt_from_onboarding=exempt,
        held_to_onboarding=owes_step and not exempt,
        onboarding=[step(row, row.form_id in on_path) for row in rows if row.is_onboarding],
        forms=[
            step(row, meets_prerequisites(row.prerequisites, role_ids))
            for row in rows
            if not row.is_onboarding
        ],
    )
