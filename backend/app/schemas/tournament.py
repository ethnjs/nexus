from __future__ import annotations
from datetime import datetime
from typing import Any
from pydantic import BaseModel, model_validator, field_validator


# ---------------------------------------------------------------------------
# Block schema — validated structure for tournament time blocks
# ---------------------------------------------------------------------------
class TournamentBlock(BaseModel):
    number: int
    label: str
    date: str   # "YYYY-MM-DD" — which day this block falls on
    start: str  # "HH:MM" 24hr format
    end: str    # "HH:MM" 24hr format

    @field_validator("date")
    @classmethod
    def validate_date_format(cls, v: str) -> str:
        from datetime import date as date_type
        try:
            date_type.fromisoformat(v)
        except ValueError:
            raise ValueError("date must be in YYYY-MM-DD format")
        return v

    @field_validator("start", "end")
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        parts = v.split(":")
        if len(parts) != 2:
            raise ValueError("Time must be in HH:MM format")
        h, m = parts
        if not h.isdigit() or not m.isdigit():
            raise ValueError("Time must be in HH:MM format")
        if not (0 <= int(h) <= 23) or not (0 <= int(m) <= 59):
            raise ValueError("Invalid time value")
        return v


# ---------------------------------------------------------------------------
# Custom field schema — one entry in volunteer_schema.custom_fields
# ---------------------------------------------------------------------------
VALID_CUSTOM_FIELD_TYPES = {"string", "boolean", "integer", "multi_select", "matrix"}

class CustomField(BaseModel):
    key: str        # snake_case identifier used in extra_data
    label: str      # human-readable label shown in the UI
    type: str       # one of VALID_CUSTOM_FIELD_TYPES

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in VALID_CUSTOM_FIELD_TYPES:
            raise ValueError(f"type must be one of: {VALID_CUSTOM_FIELD_TYPES}")
        return v

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        if not v.replace("_", "").isalnum():
            raise ValueError("key must be snake_case alphanumeric")
        return v


class VolunteerSchema(BaseModel):
    custom_fields: list[CustomField] = []


# ---------------------------------------------------------------------------
# Tournament schemas
# ---------------------------------------------------------------------------
class TournamentBase(BaseModel):
    name: str
    start_date: datetime | None = None
    end_date: datetime | None = None
    location: str | None = None
    blocks: list[TournamentBlock] = []
    volunteer_schema: VolunteerSchema = VolunteerSchema()

    @model_validator(mode="after")
    def validate_dates(self) -> TournamentBase:
        if self.start_date and self.end_date:
            if self.end_date < self.start_date:
                raise ValueError("end_date must be after start_date")
        return self

    @model_validator(mode="after")
    def validate_block_numbers(self) -> TournamentBase:
        if self.blocks:
            numbers = [b.number for b in self.blocks]
            if len(numbers) != len(set(numbers)):
                raise ValueError("Block numbers must be unique")
        return self


class TournamentCreate(TournamentBase):
    pass


class TournamentUpdate(BaseModel):
    """Partial update — all fields optional."""
    name: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    location: str | None = None
    blocks: list[TournamentBlock] | None = None
    volunteer_schema: VolunteerSchema | None = None


class TournamentRead(TournamentBase):
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}