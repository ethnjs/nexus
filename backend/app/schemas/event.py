from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, field_validator
from app.schemas.time_block import TimeBlockRead

VALID_DIVISIONS = {"B", "C"}
VALID_EVENT_TYPES = {"standard", "trial"}


class EventBase(BaseModel):
    name: str
    division: str | None = None
    event_type: str = "standard"
    category_id: int | None = None
    building: str | None = None
    room: str | None = None
    floor: str | None = None
    volunteers_needed: int = 2

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


class EventCreate(EventBase):
    tournament_id: int
    time_block_ids: list[int] = []


class EventUpdate(BaseModel):
    """Partial update — all fields optional."""
    name: str | None = None
    division: str | None = None
    event_type: str | None = None
    category_id: int | None = None
    building: str | None = None
    room: str | None = None
    floor: str | None = None
    volunteers_needed: int | None = None
    time_block_ids: list[int] | None = None


class EventBatchUpdate(BaseModel):
    """Batch-update a set of events. Only keys present in `updates` are applied."""
    event_ids: list[int]
    updates:   EventUpdate


class EventRead(EventBase):
    id: int
    tournament_id: int
    time_blocks: list[TimeBlockRead]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
