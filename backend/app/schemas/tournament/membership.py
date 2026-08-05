from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, field_validator

from app.schemas.tournament.role import RoleRead
from app.schemas.user import UserFullResponse, UserSlimResponse

LunchOrderValue = str | dict[str, Any]


class AvailabilitySlot(BaseModel):
    """A single parsed availability window matching block format."""
    date: str   # "YYYY-MM-DD"
    start: str  # "HH:MM"
    end: str    # "HH:MM"


class ScheduleSlot(BaseModel):
    """A single day-of block assignment."""
    block: int   # block number
    duty: str    # role key or free string, e.g. "event_supervisor"


class MembershipMeUpdate(BaseModel):
    """Self-service update — the fields a volunteer fills out during onboarding.

    manage_volunteers cannot write these on someone else's behalf; see
    MembershipCoordinatorUpdate for the staff-side fields.
    """
    role_preference: list[str] | None = None
    event_preference: list[str] | None = None
    availability: list[AvailabilitySlot] | None = None
    lunch_order: LunchOrderValue | None = None


class MembershipCoordinatorUpdate(BaseModel):
    """manage_volunteers override — day-of logistics only, not onboarding data."""
    schedule: list[ScheduleSlot] | None = None
    notes: Optional[str] = None


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
    """List view — members page roster. No onboarding/logistics fields;
    those live behind the per-member expand panel (MembershipFullResponse)."""
    id: int
    source: str
    join_code_id: int | None = None
    user: UserSlimResponse


class MembershipFullResponse(_MembershipRolesMixin):
    """Detail view — the expanded side panel for a single member."""
    id: int
    tournament_id: int
    assigned_event_id: int | None = None
    schedule: list[ScheduleSlot] | None = None
    status: str
    role_preference: list[str] | None = None
    event_preference: list[str] | None = None
    availability: list[AvailabilitySlot] | None = None
    lunch_order: LunchOrderValue | None = None
    notes: Optional[str] = None
    extra_data: dict | None = None
    source: str
    join_code_id: int | None = None

    is_over_18: Optional[bool] = None
    is_over_21: Optional[bool] = None

    created_at: datetime
    updated_at: datetime

    user: UserFullResponse
