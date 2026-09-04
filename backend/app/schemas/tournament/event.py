from __future__ import annotations
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app.schemas.event import EventResponse
from app.schemas.tournament import VALID_DIVISIONS
from app.schemas.tournament.shift import TournamentShiftRead

VALID_EVENT_TYPES = {"standard", "trial"}


class EventBase(BaseModel):
    # extra="forbid" so a caller still sending the old start_time/end_time is
    # rejected outright rather than quietly creating an event whose schedule
    # silently didn't save.
    model_config = ConfigDict(extra="forbid")

    # Custom (event_id-less) events only — catalog-linked events display
    # the joined Event.name instead. See the model_validator below.
    name: str | None = None
    division: str | None = None
    event_type: str = "standard"
    event_id: int | None = None
    building: str | None = None
    room: str | None = None
    floor: str | None = None
    volunteers_needed: int | None = None
    # An event's schedule *is* its shifts, and the tracks it runs on are
    # stated outright. Both are whole-set: a PATCH sending shift_ids replaces
    # the event's shifts, it doesn't add to them. Omit either to leave it
    # alone. Setting shift_ids also adds those shifts' tracks to track_ids —
    # see the route.
    shift_ids: list[int] | None = None
    track_ids: list[int] | None = None

    @field_validator("division")
    @classmethod
    def validate_division(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_DIVISIONS:
            raise ValueError(f"division must be one of: {VALID_DIVISIONS}")
        return v

    @field_validator("event_type")
    @classmethod
    def validate_event_type(cls, v: str) -> str:
        if v not in VALID_EVENT_TYPES:
            raise ValueError(f"event_type must be one of: {VALID_EVENT_TYPES}")
        return v

    @field_validator("volunteers_needed")
    @classmethod
    def validate_volunteers_needed(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("volunteers_needed must be at least 1")
        return v

    @model_validator(mode="after")
    def validate_name_or_event_id(self) -> "EventBase":
        if self.name is None and self.event_id is None:
            raise ValueError("at least one of name or event_id must be set")
        return self


class EventCreate(EventBase):
    tournament_id: int


class EventUpdate(BaseModel):
    """Partial update — all fields optional. Only the fields actually sent
    are validated against each other (mirrors current + incoming values is
    the route's job, not this schema's)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    division: str | None = None
    event_type: str | None = None
    event_id: int | None = None
    building: str | None = None
    room: str | None = None
    floor: str | None = None
    volunteers_needed: int | None = None
    # Whole-set, like on create. None means "not sent"; [] means "clear".
    shift_ids: list[int] | None = None
    track_ids: list[int] | None = None

    @field_validator("division")
    @classmethod
    def validate_division(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_DIVISIONS:
            raise ValueError(f"division must be one of: {VALID_DIVISIONS}")
        return v

    @field_validator("event_type")
    @classmethod
    def validate_event_type(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_EVENT_TYPES:
            raise ValueError(f"event_type must be one of: {VALID_EVENT_TYPES}")
        return v

    @field_validator("volunteers_needed")
    @classmethod
    def validate_volunteers_needed(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("volunteers_needed must be at least 1")
        return v


class EventRead(BaseModel):
    id: int
    tournament_id: int
    name: str | None = None
    division: str | None = None
    event_type: str
    event_id: int | None = None
    # Joined canonical event — set only when event_id is set. Carries
    # category, since TournamentEvent no longer has its own category field.
    event: EventResponse | None = None
    building: str | None = None
    room: str | None = None
    floor: str | None = None
    volunteers_needed: int | None = None
    shifts: list[TournamentShiftRead] = []
    # Every day this event runs, derived from its shifts. A list, not a
    # range — and empty for an event on a cosmetic track, which has no
    # schedule at all.
    days: list[date] = []
    track_ids: list[int] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EventMemberRead(BaseModel):
    """The member-facing event shape (?public=true).

    Deliberately only what names an event: `building`/`room`/`floor` are the
    physical assignment, which stays staff-side until the day, and
    `volunteers_needed` is a staffing target rather than anything a member
    acts on. The event's days are out too — they're a by-product of whichever
    shifts happen to be attached yet, so publishing them would imply a
    schedule the TD hasn't committed to.

    Matches the {id, name, division} shape resolve_field_options already
    gives an event_preference option, so one renderer serves both.
    """
    id: int
    name: str | None = None
    division: str | None = None

    @classmethod
    def from_row(cls, event) -> "EventMemberRead":
        # display_name, not name: a catalog-linked event carries its name on
        # the joined canonical Event, leaving its own column null.
        return cls(id=event.id, name=event.display_name, division=event.division)


class EventLoadDefaultsSkipped(BaseModel):
    event_id: int
    division: str
    name: str
    reason: str = "already loaded"


class EventLoadDefaultsResponse(BaseModel):
    created: list[EventRead]
    skipped: list[EventLoadDefaultsSkipped]
