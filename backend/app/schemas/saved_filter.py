from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.tournament.display_config import FilterGroup


def _validate_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("name must not be blank")
    return value


class SavedFilterCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    surface: str
    name: str = Field(max_length=100)
    filter: FilterGroup

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _validate_name(value)


class SavedFilterUpdate(BaseModel):
    """Partial update; the surface is fixed once saved."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=100)
    filter: FilterGroup | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str | None) -> str | None:
        return None if value is None else _validate_name(value)


class SavedFilterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    surface: str
    name: str
    filter: FilterGroup
    created_at: datetime
    updated_at: datetime
