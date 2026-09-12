from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, model_validator


class TournamentShiftCreate(BaseModel):
    # Which primary track's day this shift falls on. Required: a shift with no
    # track has no date range to validate against and no availability question
    # can ever reach it.
    track_id: int
    label: str
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def validate_times(self) -> "TournamentShiftCreate":
        if self.end <= self.start:
            raise ValueError("end must be after start")
        return self


class TournamentShiftUpdate(BaseModel):
    # Moving a shift between tracks is how a TD "fixes" the reference that
    # blocks a pending track delete — see purge_pending_tracks.
    track_id: int | None = None
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
    track_id: int
    label: str
    start: datetime
    end: datetime
    # How many TournamentEvents this shift is currently attached to — drives
    # the "attached to N events" delete-confirm warning.
    event_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
