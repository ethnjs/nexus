from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, field_validator


class TimeBlockBase(BaseModel):
    label: str
    date: str   # "YYYY-MM-DD"
    start: str  # "HH:MM" 24hr
    end: str    # "HH:MM" 24hr

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


class TimeBlockCreate(TimeBlockBase):
    pass


class TimeBlockUpdate(BaseModel):
    label: str | None = None
    date: str | None = None
    start: str | None = None
    end: str | None = None

    @field_validator("date")
    @classmethod
    def validate_date_format(cls, v: str | None) -> str | None:
        if v is None:
            return v
        from datetime import date as date_type
        try:
            date_type.fromisoformat(v)
        except ValueError:
            raise ValueError("date must be in YYYY-MM-DD format")
        return v

    @field_validator("start", "end")
    @classmethod
    def validate_time_format(cls, v: str | None) -> str | None:
        if v is None:
            return v
        parts = v.split(":")
        if len(parts) != 2:
            raise ValueError("Time must be in HH:MM format")
        h, m = parts
        if not h.isdigit() or not m.isdigit():
            raise ValueError("Time must be in HH:MM format")
        if not (0 <= int(h) <= 23) or not (0 <= int(m) <= 59):
            raise ValueError("Invalid time value")
        return v


class TimeBlockRead(TimeBlockBase):
    id: int
    tournament_id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
