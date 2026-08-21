from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator

from app.schemas.tournament.role import RoleRead
from app.schemas.user import UserFullResponse, UserSlimResponse


class MembershipMeUpdate(BaseModel):
    """Self-service update — the fields a volunteer fills out during onboarding.

    Onboarding data (role/event preference, availability, lunch) now comes
    through the native form response flow (see app/core/form/write_through.py),
    not this endpoint — no self-service fields remain here.

    manage_members cannot write these on someone else's behalf; see
    MembershipCoordinatorUpdate for the staff-side fields.
    """
    pass


class MembershipCoordinatorUpdate(BaseModel):
    """manage_members override — day-of logistics only, not onboarding data."""
    notes: Optional[str] = None


class MembershipJoinCodeInfo(BaseModel):
    """Minimal join-code info embedded on a membership response — code/label
    plus who created it ("invited by"). Not the full JoinCodeResponse:
    app.schemas.join_code imports MembershipSlimResponse from this module, so
    importing back would be circular — this duplicates just what's needed.
    Codes are never hard-deleted (deactivation only flips is_active), so this
    is populated for every membership with source == "join_code"."""
    id: int
    code: str
    label: str | None = None
    # The creator's membership in this tournament — falls back to the bare
    # user when they have none. Resolved server-side, same pattern as
    # JoinCodeResponse.creator / AuditLogEntry.actor.
    creator: "MembershipSlimResponse | UserSlimResponse"

    model_config = {"from_attributes": True}


class _MembershipRolesMixin(BaseModel):
    """Shared roles handling for response schemas.

    TournamentMembership.roles is a list of TournamentMembershipRole join
    rows, not TournamentRole rows — unwrap to the underlying role so this
    serializes as list[RoleRead].
    """
    roles: list[RoleRead] = []

    @field_validator("roles", mode="before")
    @classmethod
    def _unwrap_roles(cls, v):
        if v and hasattr(v[0], "role"):
            return [mr.role for mr in v]
        return v

    model_config = {"from_attributes": True}


class MembershipSlimResponse(_MembershipRolesMixin):
    """List view — members page roster. No onboarding/logistics fields."""
    id: int
    source: str
    status: str
    # Resolved server-side — see MembershipJoinCodeInfo. None when source
    # isn't "join_code". Supersedes the bare join_code_id FK.
    join_code: MembershipJoinCodeInfo | None = None
    # When they joined THIS tournament — distinct from user.created_at
    # (their NEXUS account age).
    created_at: datetime
    updated_at: datetime

    user: UserSlimResponse


class MembershipMeResponse(_MembershipRolesMixin):
    """GET .../memberships/me/ — current user's membership + effective permissions."""
    membership_id: int | None
    is_owner: bool
    status: str | None = None
    permissions: list[str] = []


class MembershipFullResponse(_MembershipRolesMixin):
    """Detail view — the expanded side panel for a single member."""
    id: int
    tournament_id: int
    status: str
    notes: Optional[str] = None
    source: str
    join_code: MembershipJoinCodeInfo | None = None

    is_over_18: Optional[bool] = None
    is_over_21: Optional[bool] = None

    created_at: datetime
    updated_at: datetime

    user: UserFullResponse
