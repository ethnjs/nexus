from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _TrackName(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=255)

    @field_validator("name")
    @classmethod
    def _strip_and_require_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class TournamentTrackCreate(_TrackName):
    pass


class TournamentTrackUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=255)
    is_archived: bool | None = None

    @field_validator("name")
    @classmethod
    def _strip_and_require_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class TournamentTrackRead(BaseModel):
    id: int
    tournament_id: int
    name: str
    is_archived: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
