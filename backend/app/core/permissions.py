"""
app/core/permissions.py

Permission constants, default position definitions, and the runtime
permission-checking helper used by route dependencies.

ADDING A NEW PERMISSION:
  1. Add a constant string below in the PERMISSIONS section.
  2. Add it to DEFAULT_POSITIONS for whichever positions should have it.
  3. Wire it up in the relevant route via require_permission().

ADDING A NEW DEFAULT POSITION:
  1. Add a PositionDefinition entry to DEFAULT_POSITIONS.
  2. It will be auto-populated into every newly created tournament's
     volunteer_schema. Existing tournaments are unaffected.
"""

from __future__ import annotations
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.auth import get_current_user

if TYPE_CHECKING:
    from app.models.models import User


# ---------------------------------------------------------------------------
# Permission constants
# Treat these as the canonical source of truth — import from here everywhere.
# ---------------------------------------------------------------------------

MANAGE_TOURNAMENT  = "manage_tournament"   # full access — superset of all below
MANAGE_VOLUNTEERS  = "manage_volunteers"   # read + write volunteer/membership pages
MANAGE_EVENTS      = "manage_events"       # read + write events page
MANAGE_MATERIALS   = "manage_materials"    # read + write materials page (future)
MANAGE_LOGISTICS   = "manage_logistics"    # read + write logistics page (future)
VIEW_VOLUNTEERS    = "view_volunteers"     # read-only volunteer list
VIEW_EVENTS        = "view_events"         # read-only events list

# Ordered list for documentation / UI display purposes
ALL_PERMISSIONS: list[str] = [
    MANAGE_TOURNAMENT,
    MANAGE_VOLUNTEERS,
    MANAGE_EVENTS,
    MANAGE_MATERIALS,
    MANAGE_LOGISTICS,
    VIEW_VOLUNTEERS,
    VIEW_EVENTS,
]

# manage_X permissions imply their corresponding view_X permission.
# Used in get_user_permissions() to expand effective permissions.
PERMISSION_IMPLICATIONS: dict[str, list[str]] = {
    MANAGE_TOURNAMENT: [
        MANAGE_VOLUNTEERS, MANAGE_EVENTS, MANAGE_MATERIALS,
        MANAGE_LOGISTICS, VIEW_VOLUNTEERS, VIEW_EVENTS,
    ],
    MANAGE_VOLUNTEERS: [VIEW_VOLUNTEERS],
    MANAGE_EVENTS:     [VIEW_EVENTS],
}


# ---------------------------------------------------------------------------
# Default position definitions
# Auto-populated into volunteer_schema when a tournament is created.
# TDs can customise positions (add/edit/delete) after creation.
# ---------------------------------------------------------------------------

DEFAULT_POSITIONS: list[dict] = [
    {
        "key":         "tournament_director",
        "label":       "Tournament Director",
        "permissions": [MANAGE_TOURNAMENT],
    },
    {
        "key":         "volunteer_coordinator",
        "label":       "Volunteer Coordinator",
        "permissions": [MANAGE_VOLUNTEERS],
    },
    {
        "key":         "test_coordinator",
        "label":       "Test Coordinator",
        "permissions": [MANAGE_EVENTS],
    },
    {
        "key":         "materials_coordinator",
        "label":       "Materials Coordinator",
        "permissions": [MANAGE_MATERIALS],
    },
    {
        "key":         "logistics",
        "label":       "Director of Logistics",
        "permissions": [MANAGE_LOGISTICS],
    },
    {
        "key":         "lead_event_supervisor",
        "label":       "Lead Event Supervisor",
        "permissions": [VIEW_EVENTS],
    },
    {
        "key":         "event_supervisor",
        "label":       "Event Supervisor",
        "permissions": [VIEW_EVENTS],
    },
    {
        "key":         "runner",
        "label":       "Runner",
        "permissions": [VIEW_EVENTS],
    },
    {
        "key":         "scoring",
        "label":       "Scoring",
        "permissions": [VIEW_EVENTS],
    },
    {
        "key":         "scoremaster",
        "label":       "Scoremaster",
        "permissions": [VIEW_EVENTS],
    },
    {
        "key":         "arbitrations",
        "label":       "Arbitrations",
        "permissions": [VIEW_EVENTS],
    },
    {
        "key":         "awards",
        "label":       "Awards",
        "permissions": [VIEW_EVENTS],
    },
    {
        "key":         "test_writer",
        "label":       "Test Writer",
        "permissions": [VIEW_EVENTS],
    },
    {
        "key":         "test_reviewer",
        "label":       "Test Reviewer",
        "permissions": [VIEW_EVENTS],
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
    - Everyone else: load their membership, look up each position's permissions
      in the tournament's volunteer_schema, then expand via PERMISSION_IMPLICATIONS.

    Returns an empty set if the user has no membership in this tournament.
    """
    from app.models.models import Membership, Tournament

    if user.role == "admin":
        return set(ALL_PERMISSIONS)

    membership = (
        db.query(Membership)
        .filter(
            Membership.user_id == user.id,
            Membership.tournament_id == tournament_id,
        )
        .first()
    )
    if not membership:
        return set()

    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        return set()

    # Build a lookup from position key → permissions list using this
    # tournament's volunteer_schema (may have been customised by the TD).
    schema_positions: list[dict] = (
        (tournament.volunteer_schema or {}).get("positions", [])
    )
    position_map: dict[str, list[str]] = {
        p["key"]: p.get("permissions", [])
        for p in schema_positions
    }

    # Collect raw permissions from all of the user's positions.
    raw: set[str] = set()
    for pos_key in (membership.positions or []):
        raw.update(position_map.get(pos_key, []))

    # Expand implied permissions (e.g. manage_tournament → everything).
    effective = set(raw)
    for perm in list(raw):
        effective.update(PERMISSION_IMPLICATIONS.get(perm, []))

    return effective


def has_permission(
    user: "User",
    tournament_id: int,
    permission: str,
    db: Session,
) -> bool:
    """Return True if the user holds `permission` in `tournament_id`."""
    return permission in get_user_permissions(user, tournament_id, db)


def has_any_membership(
    user: "User",
    tournament_id: int,
    db: Session,
) -> bool:
    """Return True if the user has any membership in `tournament_id`."""
    from app.models.models import Membership

    if user.role == "admin":
        return True

    return (
        db.query(Membership)
        .filter(
            Membership.user_id == user.id,
            Membership.tournament_id == tournament_id,
        )
        .first()
    ) is not None


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