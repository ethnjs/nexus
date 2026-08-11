"""
Rank-bound authority checks for TournamentRole (lower rank = higher
authority; ties are peers who can't edit each other). Final rank values for
drag-to-reorder are computed client-side and applied via a bulk endpoint —
this module just guards who's allowed to touch which ranks.
"""
from __future__ import annotations
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.tournament.permissions import get_highest_rank

if TYPE_CHECKING:
    from app.models.models import Tournament, TournamentMembership, TournamentRole, User


def with_member_counts(db: Session, roles: list["TournamentRole"]) -> list["TournamentRole"]:
    """
    Attaches member_count as a transient attribute on each role — RoleRead
    reads it via from_attributes. One grouped count query regardless of how
    many roles are passed in, so callers stay off the N+1 path.
    """
    from app.models.models import TournamentMembershipRole

    role_ids = [r.id for r in roles]
    counts = dict(
        db.query(TournamentMembershipRole.role_id, func.count(TournamentMembershipRole.id))
        .filter(TournamentMembershipRole.role_id.in_(role_ids))
        .group_by(TournamentMembershipRole.role_id)
        .all()
    ) if role_ids else {}
    for role in roles:
        role.member_count = counts.get(role.id, 0)
    return roles


def validate_rank_bound(user: "User", tournament: "Tournament", rank: int, db: Session) -> None:
    """
    A MANAGE_ROLES holder can never create or edit a role that outranks (or
    ties) their own highest role. Only the Owner and platform admins are
    exempt. MANAGE_TOURNAMENT holders don't even reach this check — role
    routes are gated on MANAGE_ROLES alone, MANAGE_TOURNAMENT is not a
    tournament-admin override. The Tournament Director role holds both and
    sits at the top rank, so it can still modify every role — that falls out
    of being the highest rank, not a permission bypass.
    """
    from app.models.models import TournamentRole

    if user.id == tournament.owner_id or user.role == "admin":
        return

    actor_rank = get_highest_rank(user, tournament.id, db)
    if actor_rank is None or rank <= actor_rank:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot create or edit a role at or above your own rank",
        )

    # Defense in depth: a MANAGE_ROLES holder's own rank is always >= the
    # tournament's live minimum rank (their rank comes from a role that
    # exists in this tournament), so this is implied by the check above —
    # but it's checked live rather than against a hardcoded floor, since
    # ranks are sparse now and there's no fixed "1 = top" constant to lean on.
    min_rank = (
        db.query(func.min(TournamentRole.rank))
        .filter(TournamentRole.tournament_id == tournament.id)
        .scalar()
    )
    if min_rank is not None and rank < min_rank:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot create or edit a role above the tournament's highest existing role",
        )


def validate_role_action(
    actor: "User",
    tournament: "Tournament",
    membership: "TournamentMembership",
    role: "TournamentRole",
    db: Session,
) -> None:
    """
    Rank-bound checks for assigning/removing `role` on `membership`. Owner and
    platform admins bypass entirely — same rationale as validate_rank_bound
    above: this route is gated on MANAGE_MEMBERS alone, MANAGE_TOURNAMENT is
    not a bypass.

    Two independent checks, both must pass:
      1. The role being assigned/removed must not outrank the actor's own
         highest rank. Self-demotion is naturally exempt (a role you're
         removing from yourself is by definition one of your own roles, so
         it can never outrank your own highest rank); self-promotion
         (assigning yourself a role above your own rank) is blocked like
         any other case.
      2. The target member's highest-ranked role overall must not outrank
         the actor — except when acting on your own membership, where this
         is a no-op (you can't outrank yourself).
    """
    if actor.id == tournament.owner_id or actor.role == "admin":
        return

    actor_rank = get_highest_rank(actor, tournament.id, db)
    if actor_rank is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    if role.rank < actor_rank:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot assign or remove a role that outranks your own",
        )

    is_self = membership.user_id == actor.id
    if not is_self:
        target_rank = get_highest_rank(membership.user, tournament.id, db)
        if target_rank is not None and target_rank < actor_rank:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot modify roles for a member who outranks you",
            )
