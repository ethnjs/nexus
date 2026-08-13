from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, model_validator


class TournamentShiftCreate(BaseModel):
    label: str
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def validate_times(self) -> "TournamentShiftCreate":
        if self.end <= self.start:
            raise ValueError("end must be after start")
        return self


class TournamentShiftUpdate(BaseModel):
    label: str | None = None
    start: datetime | None = None
    end: datetime | None = None

    @model_validator(mode="after")
    def validate_times(self) -> "TournamentShiftUpdate":
        if self.start is not None and self.end is not None and self.end <= self.start:
            raise ValueError("end must be after start")
        return self


class TournamentShiftRead(BaseModel):
    id: int
    tournament_id: int
    label: str
    start: datetime
    end: datetime
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
