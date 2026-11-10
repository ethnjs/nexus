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
    roles = role_ids_by_user(db, membership.tournament_id, [membership.user_id])
    return meets_prerequisites(tournament_form.prerequisites, roles[membership.user_id])


def role_ids_by_user(
    db: Session, tournament_id: int, user_ids: list[int] | None = None
) -> dict[int, set[int]]:
    """The role ids each member holds, for `user_ids` or the whole tournament.
    Every member is a key, with an empty set if they hold no roles."""
    query = (
        db.query(TournamentMembership.user_id, TournamentTrackAssignment.role_id)
        .outerjoin(TournamentTrackAssignment)
        .filter(TournamentMembership.tournament_id == tournament_id)
    )
    if user_ids is not None:
        query = query.filter(TournamentMembership.user_id.in_(user_ids))
    roles: dict[int, set[int]] = {}
    for user_id, role_id in query:
        held = roles.setdefault(user_id, set())
        if role_id is not None:
            held.add(role_id)
    return roles


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
