from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_validator

from app.schemas.event import EventResponse
from app.schemas.tournament import VALID_DIVISIONS
from app.schemas.tournament.event import reject_null, validate_event_format


class SeasonEventCreate(BaseModel):
    event_id: int
    year: int
    division: str
    is_active: bool = False
    format: str | None = None
    has_impound: bool = False
    has_self_schedule: bool = False

    _validate_format = field_validator("format")(validate_event_format)

    @field_validator("division")
    @classmethod
    def validate_division(cls, v: str) -> str:
        if v not in VALID_DIVISIONS:
            raise ValueError(f"division must be one of: {VALID_DIVISIONS}")
        return v


class SeasonEventUpdate(BaseModel):
    year: int | None = None
    division: str | None = None
    is_active: bool | None = None
    format: str | None = None
    has_impound: bool | None = None
    has_self_schedule: bool | None = None

    _validate_format = field_validator("format")(validate_event_format)
    _reject_null = field_validator(
        "year", "division", "is_active", "has_impound", "has_self_schedule"
    )(reject_null)

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
    format: str | None = None
    has_impound: bool = False
    has_self_schedule: bool = False
    event: EventResponse
    created_at: datetime

    model_config = {"from_attributes": True}
