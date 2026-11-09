from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.tournament.zones import KIND_BUILDING, KIND_EVENT, KIND_FLOOR, KIND_ROOM, VALID_KINDS
from app.schemas.person import PersonNameRef, PersonRoleRead


def _validate_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("name must not be blank")
    return value


class ZoneMember(BaseModel):
    """One rule saying what a zone contains. Which fields are legal depends on
    the kind, mirroring ck_zone_member_shape:

        building   building_id
        floor      building_id and floor
        room       room_id; building_id is filled in from the room
        event      tournament_event_id
    """

    model_config = ConfigDict(extra="forbid")

    kind: str
    building_id: int | None = None
    floor: str | None = None
    room_id: int | None = None
    tournament_event_id: int | None = None

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, v: str) -> str:
        if v not in VALID_KINDS:
            raise ValueError(f"kind must be one of: {sorted(VALID_KINDS)}")
        return v

    @field_validator("floor")
    @classmethod
    def _clean_floor(cls, v: str | None) -> str | None:
        return (v.strip() or None) if v is not None else None

    @model_validator(mode="after")
    def _check_shape(self) -> ZoneMember:
        if self.kind == KIND_BUILDING:
            wanted, forbidden = ("building_id",), ("floor", "room_id", "tournament_event_id")
        elif self.kind == KIND_FLOOR:
            wanted, forbidden = ("building_id", "floor"), ("room_id", "tournament_event_id")
        elif self.kind == KIND_ROOM:
            wanted, forbidden = ("room_id",), ("floor", "tournament_event_id")
        else:
            wanted, forbidden = ("tournament_event_id",), ("building_id", "floor", "room_id")

        missing = [name for name in wanted if getattr(self, name) is None]
        if missing:
            raise ValueError(f"a {self.kind} rule requires: {', '.join(missing)}")
        present = [name for name in forbidden if getattr(self, name) is not None]
        if present:
            raise ValueError(f"a {self.kind} rule must not set: {', '.join(present)}")
        return self

    def dedupe_key(self) -> tuple:
        """What makes two rules the same rule. Mirrors the partial unique
        indexes."""
        if self.kind == KIND_BUILDING:
            return (KIND_BUILDING, self.building_id)
        if self.kind == KIND_FLOOR:
            return (KIND_FLOOR, self.building_id, self.floor)
        if self.kind == KIND_ROOM:
            return (KIND_ROOM, self.room_id)
        return (KIND_EVENT, self.tournament_event_id)


class ZoneMemberRead(ZoneMember):
    id: int
    building_name: str | None = None
    room_name: str | None = None
    event_name: str | None = None

    @classmethod
    def from_row(cls, row) -> ZoneMemberRead:
        return cls(
            id=row.id,
            kind=row.kind,
            building_id=row.building_id,
            building_name=row.building.name if row.building else None,
            floor=row.floor,
            room_id=row.room_id,
            room_name=row.room.name if row.room else None,
            tournament_event_id=row.tournament_event_id,
            event_name=(row.tournament_event.display_name if row.tournament_event else None),
        )


class ZoneCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    track_id: int
    name: str = Field(max_length=255)
    members: list[ZoneMember] = []

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: str) -> str:
        return _validate_name(v)


class ZoneUpdate(BaseModel):
    """Partial update. `members` is whole-set: sending it replaces the zone's
    rules, omitting it leaves them alone."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=255)
    members: list[ZoneMember] | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: str | None) -> str | None:
        return _validate_name(v) if v is not None else v


class ZoneRead(BaseModel):
    """`members` are the zone's rules; `event_ids` are the events those rules
    currently resolve to, recomputed on every read."""

    id: int
    tournament_id: int
    track_id: int
    name: str
    members: list[ZoneMemberRead] = []
    event_ids: list[int] = []
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row, event_ids: list[int]) -> ZoneRead:
        return cls(
            id=row.id,
            tournament_id=row.tournament_id,
            track_id=row.track_id,
            name=row.name,
            members=[ZoneMemberRead.from_row(m) for m in row.members],
            event_ids=event_ids,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


class ZoneCoverageRead(BaseModel):
    """One track's zones plus the events they miss."""

    track_id: int
    zones: list[ZoneRead] = []
    unzoned_event_ids: list[int] = []
    # No room at all. Not a subset of unzoned_event_ids: an explicit event
    # rule zones an unplaced event.
    unplaced_event_ids: list[int] = []


# ---------------------------------------------------------------------------
# Zone assignments
# ---------------------------------------------------------------------------
class ZoneAssignmentCreate(BaseModel):
    """Omitting `role_id` takes the track's `zone_default_role_id`; with
    neither, the request is a 422."""

    model_config = ConfigDict(extra="forbid")

    zone_id: int
    membership_id: int
    role_id: int | None = None


class ZoneAssignmentRead(BaseModel):
    id: int
    zone_id: int
    zone_name: str
    track_id: int
    member: PersonNameRef
    role: PersonRoleRead
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row) -> ZoneAssignmentRead:
        return cls(
            id=row.id,
            zone_id=row.zone_id,
            zone_name=row.zone.name,
            track_id=row.zone.track_id,
            member=PersonNameRef.from_membership(row.membership),
            role=PersonRoleRead(id=row.role_id, label=row.role.label),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
