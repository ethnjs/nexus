from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, field_validator

# No declined/removed states — a member who doesn't confirm is removed by
# deleting the TournamentMembership row, not by tracking a status for it.
VALID_STATUSES = {"interested", "confirmed"}
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
    notes: Optional[str] = None

    # Catch-all for tournament-specific fields defined in volunteer_schema.custom_fields.
    # Anything tournament-specific that doesn't map to a standard field lives here —
    # e.g. transportation, carpool_seats, general_volunteer_interest, etc.
    # Keys match custom_field.key in the tournament's volunteer_schema.
    extra_data: dict | None = None

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
    status: Optional[str] = None
    role_preference: list[str] | None = None
    event_preference: list[str] | None = None
    availability: list[AvailabilitySlot] | None = None
    lunch_order: LunchOrderValue | None = None
    notes: Optional[str] = None
    extra_data: dict | None = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_STATUSES:
            raise ValueError(f"status must be one of: {VALID_STATUSES}")
        return v


class MembershipRead(MembershipBase):
    id: int

    is_over_18: Optional[bool] = None
    is_over_21: Optional[bool] = None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MembershipReadFlat(MembershipRead):
    """List-view read: user identity fields flattened onto the membership dict.

    Avoids a nested user object in list responses. The four fields below are
    sourced from the User table via a JOIN and promoted to the top level.

    # TODO(temp): these fields are sourced from User — when the user profile
    # page is built, the full user profile (beyond identity) should continue
    # to come from User, not Membership.
    """
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
