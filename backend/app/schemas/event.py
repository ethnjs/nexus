from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, field_validator

VALID_DIVISIONS = {"B", "C"}
VALID_EVENT_TYPES = {"standard", "trial"}


class EventBase(BaseModel):
    name: str
    division: str
    event_type: str = "standard"
    category: str | None = None
    building: str | None = None
    room: str | None = None
    floor: str | None = None
    volunteers_needed: int = 2
    # Block numbers this event runs e.g. [1,2,3,4,5,6]
    # Empty list means the TD hasn't configured blocks yet
    blocks: list[int] = []

    @field_validator("division")
    @classmethod
    def validate_division(cls, v: str) -> str:
        if v not in VALID_DIVISIONS:
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

    @field_validator("blocks")
    @classmethod
    def validate_blocks(cls, v: list[int]) -> list[int]:
        if len(v) != len(set(v)):
            raise ValueError("Block numbers must be unique")
        if any(b < 1 for b in v):
            raise ValueError("Block numbers must be positive integers")
        return sorted(v)


class EventCreate(EventBase):
    tournament_id: int


class EventUpdate(BaseModel):
    """Partial update — all fields optional."""
    name: str | None = None
    division: str | None = None
    event_type: str | None = None
    category: str | None = None
    building: str | None = None
    room: str | None = None
    floor: str | None = None
    volunteers_needed: int | None = None
    blocks: list[int] | None = None


class EventRead(EventBase):
    id: int
    tournament_id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}