"""Eligibility evaluation for standard tournament forms.

TournamentForm.prerequisites is deliberately evaluated here, rather than in a
route, so listing a member's forms and protecting direct render/submission
links cannot drift apart.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.models import (
    TournamentForm,
    TournamentMembership,
    TournamentMembershipAvailability,
    TournamentMembershipRole,
)


def member_meets_form_prerequisites(
    db: Session,
    membership: TournamentMembership,
    tournament_form: TournamentForm,
) -> bool:
    """Return whether ``membership`` passes every configured requirement.

    The persisted shape is::

        {
          "onboarding_complete": true,
          "roles": {"ids": [1, 2], "match": "any"},
          "availability": {"shift_ids": [3, 4], "match": "all"}
        }

    An omitted or empty group does not constrain access. Manager-side schema
    validation is added with the prerequisite API; this evaluator fails closed
    for malformed non-empty groups so corrupt JSON cannot grant visibility.
    """
    prerequisites = tournament_form.prerequisites or {}
    if not isinstance(prerequisites, dict):
        return False

    if prerequisites.get("onboarding_complete") is True and membership.onboarded_at is None:
        return False

    roles = prerequisites.get("roles")
    if not _matches_group(
        roles,
        _membership_role_ids(db, membership.id),
        id_key="ids",
    ):
        return False

    availability = prerequisites.get("availability")
    if not _matches_group(
        availability,
        _membership_shift_ids(db, membership.id),
        id_key="shift_ids",
    ):
        return False

    return True


def _matches_group(group: object, actual_ids: set[int], *, id_key: str) -> bool:
    """Apply an optional any/all ID group against the member's IDs."""
    if group is None:
        return True
    if not isinstance(group, dict):
        return False

    required_ids = group.get(id_key, [])
    if not isinstance(required_ids, list) or not all(isinstance(item, int) for item in required_ids):
        return False
    if not required_ids:
        return True

    match = group.get("match", "any")
    required = set(required_ids)
    if match == "any":
        return bool(required & actual_ids)
    if match == "all":
        return required <= actual_ids
    return False


def _membership_role_ids(db: Session, membership_id: int) -> set[int]:
    return {
        role_id
        for (role_id,) in db.query(TournamentMembershipRole.role_id)
        .filter(TournamentMembershipRole.membership_id == membership_id)
        .all()
    }


def _membership_shift_ids(db: Session, membership_id: int) -> set[int]:
    return {
        shift_id
        for (shift_id,) in db.query(TournamentMembershipAvailability.tournament_shift_id)
        .filter(TournamentMembershipAvailability.membership_id == membership_id)
        .all()
    }
