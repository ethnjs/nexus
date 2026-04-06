from __future__ import annotations
from datetime import datetime
from typing import Any
from pydantic import BaseModel, field_validator
from app.schemas.user import UserRead

VALID_STATUSES = {"interested", "confirmed", "declined", "assigned", "removed"}
LunchOrderValue = str | dict[str, Any]


class AvailabilitySlot(BaseModel):
    """A single parsed availability window matching block format."""
    date: str   # "YYYY-MM-DD"
    start: str  # "HH:MM"
    end: str    # "HH:MM"


class ScheduleSlot(BaseModel):
    """A single day-of block assignment."""
    block: int   # block number
    duty: str    # position key or free string, e.g. "event_supervisor"


class MembershipBase(BaseModel):
    user_id: int
    tournament_id: int
    assigned_event_id: int | None = None

    # Position keys from tournament.volunteer_schema["positions"].
    # Drives both title and system permissions within this tournament.
    # e.g. ["lead_event_supervisor", "test_writer"]
    positions: list[str] | None = None

    # Day-of block schedule — one entry per block.
    # e.g. [{"block": 1, "duty": "event_supervisor"}, {"block": 7, "duty": "scoring"}]
    schedule: list[ScheduleSlot] | None = None

    status: str = "interested"

    # What they asked for on the form — ["event_volunteer", "general_volunteer"]
    role_preference: list[str] | None = None

    # Specific event names they prefer — ["Boomilever", "Hovercraft"]
    event_preference: list[str] | None = None

    # Normalized availability — [{date, start, end}, ...]
    availability: list[AvailabilitySlot] | None = None

    lunch_order: LunchOrderValue | None = None
    notes: str | None = None

    # Catch-all for tournament-specific fields defined in volunteer_schema.custom_fields.
    # Anything tournament-specific that doesn't map to a standard field lives here —
    # e.g. transportation, carpool_seats, general_volunteer_interest, etc.
    # Keys match custom_field.key in the tournament's volunteer_schema.
    extra_data: dict | None = None

    # TODO(temp): remove when user account self-management is implemented
    shirt_size: str | None = None
    dietary_restriction: str | None = None
    university: str | None = None
    major: str | None = None
    employer: str | None = None
    student_status: str | None = None
    competition_exp: str | None = None
    volunteering_exp: str | None = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in VALID_STATUSES:
            raise ValueError(f"status must be one of: {VALID_STATUSES}")
        return v


class MembershipCreate(MembershipBase):
    pass


class MembershipUpdate(BaseModel):
    """Partial update — TD/coordinator manual override for any field."""
    assigned_event_id: int | None = None
    positions: list[str] | None = None
    schedule: list[ScheduleSlot] | None = None
    status: str | None = None
    role_preference: list[str] | None = None
    event_preference: list[str] | None = None
    availability: list[AvailabilitySlot] | None = None
    lunch_order: LunchOrderValue | None = None
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
