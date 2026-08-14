from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, field_validator

from app.schemas.event import EventResponse
from app.schemas.tournament import VALID_DIVISIONS
    

class SeasonEventCreate(BaseModel):
    event_id: int
    year: int
    division: str
    is_active: bool = False

    @field_validator("division")
    @classmethod
    def validate_division(cls, v: str) -> str:
        if v not in VALID_DIVISIONS:
            raise ValueError(f"division must be one of: {VALID_DIVISIONS}")
        return v


class SeasonEventUpdate(BaseModel):
    """Partial update — primarily used to toggle is_active."""
    year: int | None = None
    division: str | None = None
    is_active: bool | None = None

    @field_validator("division")
    @classmethod
    def validate_division(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_DIVISIONS:
            raise ValueError(f"division must be one of: {VALID_DIVISIONS}")
        return v


class SeasonEventRead(BaseModel):
    id: int
    year: int
    division: str
    is_active: bool
    event: EventResponse
    created_at: datetime

    model_config = {"from_attributes": True}
