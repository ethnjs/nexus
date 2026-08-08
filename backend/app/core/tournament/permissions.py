"""
app/core/tournament/permissions.py

Permission constants, default role definitions, and the runtime
permission-checking helper used by route dependencies.

ADDING A NEW PERMISSION:
  1. Add a constant string below in the PERMISSIONS section.
  2. Add it to DEFAULT_ROLES for whichever roles should have it.
  3. Wire it up in the relevant route via require_permission().

ADDING A NEW DEFAULT ROLE:
  1. Add a RoleDefinition-shaped entry to DEFAULT_ROLES, including rank.
  2. It's bulk-created via POST /tournaments/{id}/roles/apply-template/, the
     empty-state action — not auto-populated on create.
"""

from __future__ import annotations
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.auth import get_current_user
from app.core.tournament.memberships import has_any_membership

if TYPE_CHECKING:
    from app.models.models import User


# ---------------------------------------------------------------------------
# Permission constants
# Treat these as the canonical source of truth — import from here everywhere.
# ---------------------------------------------------------------------------

MANAGE_TOURNAMENT  = "manage_tournament"   # full access — superset of all below
MANAGE_ROLES       = "manage_roles"        # role *definitions* only — create/edit/delete a role, reorder rank
MANAGE_MEMBERS     = "manage_members"      # membership data — roster + assign member roles
MANAGE_EVENTS      = "manage_events"       # read + write events page

# Ordered list for documentation / UI display purposes
ALL_PERMISSIONS: list[str] = [
    MANAGE_TOURNAMENT,
    MANAGE_ROLES,
    MANAGE_MEMBERS,
    MANAGE_EVENTS,
]



# ---------------------------------------------------------------------------
# Default role definitions
# NOT auto-populated on tournament create — new tournaments start with zero
# roles (the Owner still has full permissions via Tournament.owner_id, so
# nothing breaks). This list is served as a preview via
# GET /tournaments/{id}/roles/default-template/ for the TD to review, edit,
# and save (looping the existing POST/PATCH role routes) from the roles UI's
# empty state.
#
# Rank tiers (lower = higher authority; sparse gaps of 10 to leave room for
# drag-to-reorder without a full rebalance — see core/roles.py):
#   10: Tournament Director
#   20: Volunteer/Test/Materials/Logistics Coordinator, Runner, Scoremaster
#   30: Lead Event Supervisor
#   40: Event Supervisor, Scoring, Arbitrations, Awards, Test Writer/Reviewer
# Owner is NOT in this list — it's never a role, it's Tournament.owner_id.
# ---------------------------------------------------------------------------

DEFAULT_ROLES: list[dict] = [
    {
        "label":       "Tournament Director",
        "rank":        10,
        "permissions": [MANAGE_TOURNAMENT, MANAGE_ROLES, MANAGE_MEMBERS, MANAGE_EVENTS],
    },
    {
        "label":       "Volunteer Coordinator",
        "rank":        20,
        "permissions": [MANAGE_MEMBERS, MANAGE_ROLES, MANAGE_EVENTS],
    },
    {
        "label":       "Test Coordinator",
        "rank":        20,
        "permissions": [MANAGE_MEMBERS, MANAGE_EVENTS, MANAGE_ROLES],
    },
    {
        "label":       "Materials Coordinator",
        "rank":        20,
        "permissions": [],
    },
    {
        "label":       "Logistics Coordinator",
        "rank":        20,
        "permissions": [],
    },
    {
        "label":       "Runner",
        "rank":        20,
        "permissions": [],
    },
    {
        "label":       "Scoremaster",
        "rank":        20,
        "permissions": [],
    },
    {
        "label":       "Lead Event Supervisor",
        "rank":        30,
        "permissions": [],
    },
    {
        "label":       "Volunteer",
        "rank":        40,
        "permissions": [],
    },
    {
        "label":       "Scoring",
        "rank":        40,
        "permissions": [],
    },
    {
        "label":       "Arbitrations",
        "rank":        40,
        "permissions": [],
    },
    {
        "label":       "Awards",
        "rank":        40,
        "permissions": [],
    },
    {
        "label":       "Test Writer",
        "rank":        40,
        "permissions": [],
    },
    {
        "label":       "Test Reviewer",
        "rank":        40,
        "permissions": [],
    },
]


# ---------------------------------------------------------------------------
# Runtime permission helpers
# ---------------------------------------------------------------------------

def get_user_permissions(
    user: "User",
    tournament_id: int,
    db: Session,
) -> set[str]:
    """
    Return the full set of effective permissions for `user` in `tournament_id`.

    - admin users get all permissions without a DB lookup.
    - the tournament owner gets all permissions — ownership sits structurally
      above the role/rank system, not implemented as a role.
    - Everyone else: load their membership, look up each TournamentRole's
      permissions via MembershipRole, and union them. Each role's permission
      list is explicit (no implied expansion).

    Returns an empty set if the user has no membership in this tournament.
    """
    from app.models.models import TournamentMembership, TournamentRole, Tournament

    if user.role == "admin":
        return set(ALL_PERMISSIONS)

    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        return set()

    if user.id == tournament.owner_id:
        return set(ALL_PERMISSIONS)

    membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == user.id,
            TournamentMembership.tournament_id == tournament_id,
        )
        .first()
    )
    if not membership:
        return set()

    role_ids = [mr.role_id for mr in membership.roles]
    roles = db.query(TournamentRole).filter(TournamentRole.id.in_(role_ids)).all()

    effective: set[str] = set()
    for role in roles:
        effective.update(role.permissions or [])

    return effective


def has_permission(
    user: "User",
    tournament_id: int,
    permission: str,
    db: Session,
) -> bool:
    """Return True if the user holds `permission` in `tournament_id`."""
    return permission in get_user_permissions(user, tournament_id, db)


def get_highest_rank(
    user: "User",
    tournament_id: int,
    db: Session,
) -> int | None:
    """
    Lowest TournamentRole.rank number (= highest authority) among `user`'s own
    role assignments in `tournament_id`. Lower number = higher authority.

    Returns None if the user has no membership or holds no roles — callers
    should treat None as "no rank," i.e. the most restrictive case, not as
    unbounded authority.
    """
    from sqlalchemy import func
    from app.models.models import TournamentMembership, TournamentRole

    membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == user.id,
            TournamentMembership.tournament_id == tournament_id,
        )
        .first()
    )
    if not membership:
        return None

    role_ids = [mr.role_id for mr in membership.roles]
    if not role_ids:
        return None

    return (
        db.query(func.min(TournamentRole.rank))
        .filter(TournamentRole.id.in_(role_ids))
        .scalar()
    )


# ---------------------------------------------------------------------------
# FastAPI dependency factories
# ---------------------------------------------------------------------------

def require_membership(tournament_id_param: str = "tournament_id"):
    """
    Dependency factory — requires the current user to have ANY membership
    in the tournament identified by `tournament_id_param` path parameter.

    Usage:
        @router.get("/{tournament_id}/events")
        def list_events(
            tournament_id: int,
            ...
            _: None = Depends(require_membership()),
        ):
    """
    def _dependency(
        tournament_id: int,
        current_user: "User" = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> "User":
        if not has_any_membership(current_user, tournament_id, db):
            # 404 to avoid leaking tournament existence
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tournament not found",
            )
        return current_user
    return _dependency


def require_permission(
    permission: str,
    tournament_id_param: str = "tournament_id",
):
    """
    Dependency factory — requires the current user to hold `permission`
    in the tournament identified by `tournament_id_param` path parameter.

    Usage:
        @router.post("/{tournament_id}/events")
        def create_event(
            tournament_id: int,
            ...
            _: None = Depends(require_permission(MANAGE_EVENTS)),
        ):
    """
    def _dependency(
        tournament_id: int,
        current_user: "User" = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> "User":
        # First check membership exists (404 before 403)
        if not has_any_membership(current_user, tournament_id, db):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tournament not found",
            )
        if not has_permission(current_user, tournament_id, permission, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user
    return _dependency