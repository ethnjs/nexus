"""A member's onboarding path: the tournament's onboarding steps, narrowed to
the ones that apply to them.

A step is on the path when the member passes its prerequisites and it's either
published or archived after they answered it. Drafts are left off (unless a
manager previews them), and so is an archived step they never answered, since
it can no longer be answered.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.tournament.form_prerequisites import meets_prerequisites
from app.models.models import (
    Form,
    FormResponse,
    TournamentForm,
    TournamentMembership,
    TournamentTrackAssignment,
    utcnow,
)


@dataclass(frozen=True)
class OnboardingStep:
    form_id: str
    name: str
    status: str
    completed: bool


@dataclass(frozen=True)
class OnboardingProgress:
    """The member's next required form, if any, in the active sequence."""

    next_form_id: str | None


def onboarding_paths(
    db: Session,
    tournament_id: int,
    user_ids: list[int],
    *,
    include_drafts: bool = False,
) -> dict[int, list[OnboardingStep]]:
    """Each user's ordered path, in three queries whatever the roster size."""
    steps = (
        db.query(TournamentForm)
        .join(Form, TournamentForm.form_id == Form.id)
        .filter(
            TournamentForm.tournament_id == tournament_id,
            TournamentForm.is_onboarding == True,
            Form.status.in_(
                ["published", "archived", "draft"] if include_drafts else ["published", "archived"]
            ),
        )
        .order_by(TournamentForm.order)
        .all()
    )
    paths: dict[int, list[OnboardingStep]] = {user_id: [] for user_id in user_ids}
    if not steps or not user_ids:
        return paths

    answered: dict[int, set[str]] = {}
    for user_id, form_id in db.query(FormResponse.user_id, FormResponse.form_id).filter(
        FormResponse.form_id.in_([step.form_id for step in steps]),
        FormResponse.user_id.in_(user_ids),
    ):
        answered.setdefault(user_id, set()).add(form_id)

    role_ids: dict[int, set[int]] = {}
    for user_id, role_id in (
        db.query(TournamentMembership.user_id, TournamentTrackAssignment.role_id)
        .join(TournamentTrackAssignment)
        .filter(
            TournamentMembership.tournament_id == tournament_id,
            TournamentMembership.user_id.in_(user_ids),
        )
    ):
        role_ids.setdefault(user_id, set()).add(role_id)

    for user_id, path in paths.items():
        done = answered.get(user_id, set())
        roles = role_ids.get(user_id, set())
        for step in steps:
            completed = step.form_id in done
            if step.form.status == "archived" and not completed:
                continue
            if not meets_prerequisites(step.prerequisites, roles):
                continue
            path.append(
                OnboardingStep(
                    form_id=step.form_id,
                    name=step.form.name,
                    status=step.form.status,
                    completed=completed,
                )
            )
    return paths


def _next_step(path: list[OnboardingStep]) -> OnboardingStep | None:
    return next((step for step in path if step.status == "published" and not step.completed), None)


def next_required_onboarding_form_id(
    db: Session,
    membership: TournamentMembership,
) -> str | None:
    """The next unanswered published step on the member's path. Reading never
    marks anyone onboarded; ``advance_onboarding_progress`` owns that write."""
    path = onboarding_paths(db, membership.tournament_id, [membership.user_id])[membership.user_id]
    step = _next_step(path)
    return step.form_id if step else None


def advance_onboarding_progress(
    db: Session,
    membership: TournamentMembership,
) -> OnboardingProgress:
    """Find the next required step and bring onboarded_at up to date with it.

    Role changes don't recompute onboarded_at, so this corrects it in both
    directions; a member who's still complete keeps their original time.
    """
    next_form_id = next_required_onboarding_form_id(db, membership)
    if next_form_id is None and membership.onboarded_at is None:
        membership.onboarded_at = utcnow()
    elif next_form_id is not None:
        membership.onboarded_at = None

    return OnboardingProgress(next_form_id=next_form_id)


def recompute_onboarding(db: Session, tournament_id: int) -> None:
    """Re-derive every member's onboarded_at; call whenever the sequence
    changes. Keeps an existing completion time. Does not commit."""
    # The session doesn't autoflush — without this the queries below would
    # read the sequence as it was before the caller's change.
    db.flush()
    memberships = (
        db.query(TournamentMembership)
        .filter(TournamentMembership.tournament_id == tournament_id)
        .all()
    )
    paths = onboarding_paths(db, tournament_id, [m.user_id for m in memberships])

    now = utcnow()
    for membership in memberships:
        complete = _next_step(paths[membership.user_id]) is None
        if complete and membership.onboarded_at is None:
            membership.onboarded_at = now
        elif not complete and membership.onboarded_at is not None:
            membership.onboarded_at = None


def needs_tournament_onboarding(
    db: Session,
    membership: TournamentMembership,
    permissions: set[str],
) -> bool:
    """Whether the member is held to the onboarding sequence before reaching
    the rest of the tournament."""
    if exempt_from_onboarding(membership, permissions):
        return False
    return next_required_onboarding_form_id(db, membership) is not None


def exempt_from_onboarding(membership: TournamentMembership, permissions: set[str]) -> bool:
    """Anyone holding a tournament permission is exempt, and so is everyone in an
    archived tournament, where nothing can be answered."""
    return bool(permissions) or membership.tournament.is_archived
