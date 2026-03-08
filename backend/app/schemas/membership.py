from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, field_validator
from app.schemas.user import UserRead

VALID_STATUSES = {"interested", "confirmed", "declined", "assigned", "removed"}

VALID_ROLES = {
    "event_supervisor",
    "lead_event_supervisor",
    "tournament_director",
    "runner",
    "scoremaster",
    "score_counselor",
    "photography",
    "awards",
    "general_volunteer",
}


class AvailabilitySlot(BaseModel):
    """A single parsed availability window matching block format."""
    date: str   # "YYYY-MM-DD"
    start: str  # "HH:MM"
    end: str    # "HH:MM"


class MembershipBase(BaseModel):
    user_id: int
    tournament_id: int
    assigned_event_id: int | None = None
    status: str = "interested"
    roles: dict[str, list[int]] | None = None
    role_preference: list[str] | None = None
    event_preference: list[str] | None = None
    general_volunteer_interest: list[str] | None = None
    availability: list[AvailabilitySlot] | None = None
    lunch_order: str | None = None
    notes: str | None = None
    extra_data: dict | None = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in VALID_STATUSES:
            raise ValueError(f"status must be one of: {VALID_STATUSES}")
        return v

    @field_validator("roles")
    @classmethod
    def validate_roles(cls, v: dict | None) -> dict | None:
        if v is None:
            return v
        invalid = [r for r in v.keys() if r not in VALID_ROLES]
        if invalid:
            raise ValueError(f"Invalid roles: {invalid}. Must be one of: {VALID_ROLES}")
        return v


class MembershipCreate(MembershipBase):
    pass


class MembershipUpdate(BaseModel):
    """Partial update — TD manual override for any field."""
    assigned_event_id: int | None = None
    status: str | None = None
    roles: dict[str, list[int]] | None = None
    role_preference: list[str] | None = None
    event_preference: list[str] | None = None
    general_volunteer_interest: list[str] | None = None
    availability: list[AvailabilitySlot] | None = None
    lunch_order: str | None = None
    notes: str | None = None
    extra_data: dict | None = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_STATUSES:
            raise ValueError(f"status must be one of: {VALID_STATUSES}")
        return v


class MembershipRead(MembershipBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MembershipReadWithUser(MembershipRead):
    """Extended read that includes user details — used in volunteer list views."""
    user: UserRead | None = None