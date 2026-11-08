from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.rooms import room_sort_key


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


def _validate_track_ids(value: list[int]) -> list[int]:
    """A building on no track can hold nothing, so it may not exist — neither
    created that way nor edited into it. Delete it instead."""
    if not value:
        raise ValueError("a building must be available on at least one track")
    return _dedupe_track_ids(value)


class TournamentBuildingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=255)
    # Which tracks this building is in use on — at least one. Whole-set, like
    # an event's shift_ids: sending it replaces the tags rather than adding.
    track_ids: list[int]

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _validate_name(value)

    @field_validator("track_ids")
    @classmethod
    def _check_track_ids(cls, value: list[int]) -> list[int]:
        return _validate_track_ids(value)


class TournamentBuildingUpdate(BaseModel):
    """Partial update. None means "not sent". When sent, track_ids replaces the
    tags whole-set and must still name at least one track."""

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
        return _validate_track_ids(value) if value is not None else value


def _clean_floor(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


class TournamentRoomRead(BaseModel):
    """`floor` is the override; null means it is derived from the name."""

    id: int
    name: str
    floor: str | None = None

    model_config = ConfigDict(from_attributes=True)


def sorted_rooms(rooms) -> list[TournamentRoomRead]:
    return [
        TournamentRoomRead.model_validate(room)
        for room in sorted(rooms, key=lambda room: room_sort_key(room.name))
    ]


class TournamentRoomsCreate(BaseModel):
    """Names are trimmed and blanks dropped, so a pasted list can be sent as
    its lines."""

    model_config = ConfigDict(extra="forbid")

    names: list[str]

    @field_validator("names")
    @classmethod
    def _check_names(cls, value: list[str]) -> list[str]:
        names = list(dict.fromkeys(name.strip() for name in value if name.strip()))
        if not names:
            raise ValueError("names must include at least one room")
        too_long = [name for name in names if len(name) > 64]
        if too_long:
            raise ValueError(f"room names must be at most 64 characters: {too_long[0]}")
        return names


class TournamentRoomUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=64)
    floor: str | None = Field(default=None, max_length=64)

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str | None) -> str | None:
        return _validate_name(value) if value is not None else value

    @field_validator("floor")
    @classmethod
    def _check_floor(cls, value: str | None) -> str | None:
        return _clean_floor(value)


class TournamentBuildingRead(BaseModel):
    """Ids rather than embedded track rows, unlike EventRead.tracks: every
    reader of a building already holds the track catalog (the buildings page
    is laid out per track), so embedding would repeat the same handful of
    rows once per building for nothing."""

    id: int
    tournament_id: int
    name: str
    track_ids: list[int] = []
    rooms: list[TournamentRoomRead] = []
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_row(cls, row) -> TournamentBuildingRead:
        # track_ids is not a column — from_attributes alone can't reach
        # through the bridge to build it.
        return cls(
            id=row.id,
            tournament_id=row.tournament_id,
            name=row.name,
            track_ids=[track.id for track in row.tracks],
            rooms=sorted_rooms(row.rooms),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


class TournamentBuildingDeleteResult(BaseModel):
    """What the delete cost. Mirrors TournamentTrackDeleteResult: a building
    still holding events can be removed, but the number of event locations it
    blanked is reported rather than left to be discovered."""

    locations_cleared: int = 0
