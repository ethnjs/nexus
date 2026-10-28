"""Eligibility evaluation for tournament forms.

Evaluated here, rather than in a route, so listing a member's forms, the
render/submit gate and the manager's preview can't drift apart.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.models import TournamentForm, TournamentMembership, TournamentTrackAssignment


def member_meets_form_prerequisites(
    db: Session,
    membership: TournamentMembership,
    tournament_form: TournamentForm,
) -> bool:
    return meets_prerequisites(
        tournament_form.prerequisites, _membership_role_ids(db, membership.id)
    )


def meets_prerequisites(prerequisites: object, role_ids: set[int]) -> bool:
    """Whether a member holding `role_ids` passes every role condition.

    The stored shape is ``{"roles": [{"ids": [1, 2], "match": "any", "inverse": false}]}``.
    Malformed JSON fails closed so a corrupt row can't grant access.
    """
    if not prerequisites:
        return True
    if not isinstance(prerequisites, dict):
        return False
    conditions = prerequisites.get("roles", [])
    if not isinstance(conditions, list):
        return False
    return all(_passes(condition, role_ids) for condition in conditions)


def _passes(condition: object, role_ids: set[int]) -> bool:
    if not isinstance(condition, dict):
        return False
    ids = condition.get("ids")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, int) for i in ids):
        return False

    match = condition.get("match", "any")
    if match == "any":
        holds = bool(set(ids) & role_ids)
    elif match == "all":
        holds = set(ids) <= role_ids
    else:
        return False
    return holds != (condition.get("inverse") is True)


def _membership_role_ids(db: Session, membership_id: int) -> set[int]:
    return {
        role_id
        for (role_id,) in db.query(TournamentTrackAssignment.role_id)
        .filter(TournamentTrackAssignment.membership_id == membership_id)
        .all()
    }
