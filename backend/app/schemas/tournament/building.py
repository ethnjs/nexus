from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _validate_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("name must not be blank")
    return value


def _dedupe_track_ids(value: list[int]) -> list[int]:
    """Sorted and deduplicated. The bridge's primary key would reject a repeat
    anyway; normalizing here means the route never has to care whether the
    client sent one."""
    return sorted(set(value))


class TournamentBuildingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=255)
    # Which tracks this building is in use on. Whole-set, like an event's
    # shift_ids: sending it replaces the tags rather than adding to them.
    # Empty is legal — a building entered before the schedule is settled is
    # simply not available anywhere yet.
    track_ids: list[int] = []

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _validate_name(value)

    @field_validator("track_ids")
    @classmethod
    def _check_track_ids(cls, value: list[int]) -> list[int]:
        return _dedupe_track_ids(value)


class TournamentBuildingUpdate(BaseModel):
    """Partial update. None means "not sent"; [] on track_ids means "clear",
    matching how an event's shift_ids and track_details already behave."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=255)
    track_ids: list[int] | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str | None) -> str | None:
        return _validate_name(value) if value is not None else value

    @field_validator("track_ids")
    @classmethod
    def _check_track_ids(cls, value: list[int] | None) -> list[int] | None:
        return _dedupe_track_ids(value) if value is not None else value


class TournamentBuildingRead(BaseModel):
    """Ids rather than embedded track rows, unlike EventRead.tracks: every
    reader of a building already holds the track catalog (the buildings page
    is laid out per track), so embedding would repeat the same handful of
    rows once per building for nothing."""

    id: int
    tournament_id: int
    name: str
    track_ids: list[int] = []
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_row(cls, row) -> "TournamentBuildingRead":
        # track_ids is not a column — from_attributes alone can't reach
        # through the bridge to build it.
        return cls(
            id=row.id,
            tournament_id=row.tournament_id,
            name=row.name,
            track_ids=[track.id for track in row.tracks],
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


class TournamentBuildingDeleteResult(BaseModel):
    """What the delete cost. Mirrors TournamentTrackDeleteResult: a building
    still holding events can be removed, but the number of event locations it
    blanked is reported rather than left to be discovered."""

    locations_cleared: int = 0
