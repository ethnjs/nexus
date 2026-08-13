from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, field_validator, model_validator

from app.schemas.event import EventResponse
from app.schemas.tournament import VALID_DIVISIONS
from app.schemas.tournament.shift import TournamentShiftRead

VALID_EVENT_TYPES = {"standard", "trial"}


class EventBase(BaseModel):
    # Custom (event_id-less) events only — catalog-linked events display
    # the joined Event.name instead. See the model_validator below.
    name: str | None = None
    division: str | None = None
    event_type: str = "standard"
    event_id: int | None = None
    building: str | None = None
    room: str | None = None
    floor: str | None = None
    volunteers_needed: int = 2
    start_time: datetime
    end_time: datetime

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
    def validate_volunteers_needed(cls, v: int) -> int:
        if v < 1:
            raise ValueError("volunteers_needed must be at least 1")
        return v

    @model_validator(mode="after")
    def validate_times(self) -> "EventBase":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self

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
    name: str | None = None
    division: str | None = None
    event_type: str | None = None
    event_id: int | None = None
    building: str | None = None
    room: str | None = None
    floor: str | None = None
    volunteers_needed: int | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None

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

    @model_validator(mode="after")
    def validate_times(self) -> "EventUpdate":
        if self.start_time is not None and self.end_time is not None and self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


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
    volunteers_needed: int
    start_time: datetime
    end_time: datetime
    shifts: list[TournamentShiftRead] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
