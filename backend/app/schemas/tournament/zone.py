from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.tournament.zones import KIND_BUILDING, KIND_EVENT, KIND_FLOOR, VALID_KINDS
from app.schemas.person import PersonNameRef, PersonRoleRead


def _validate_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("name must not be blank")
    return value


class ZoneMember(BaseModel):
    """One rule saying what a zone contains.

    Three kinds, and which columns are legal depends on which:

        building   building_id only
        floor      building_id and floor
        event      tournament_event_id only

    The same shape the database CheckConstraint enforces, restated here so a
    malformed rule is a 422 naming the problem rather than an IntegrityError.
    """

    model_config = ConfigDict(extra="forbid")

    kind: str
    building_id: int | None = None
    floor: str | None = None
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
    def _check_shape(self) -> "ZoneMember":
        if self.kind == KIND_BUILDING:
            wanted, forbidden = ("building_id",), ("floor", "tournament_event_id")
        elif self.kind == KIND_FLOOR:
            wanted, forbidden = ("building_id", "floor"), ("tournament_event_id",)
        else:
            wanted, forbidden = ("tournament_event_id",), ("building_id", "floor")

        missing = [name for name in wanted if getattr(self, name) is None]
        if missing:
            raise ValueError(f"a {self.kind} rule requires: {', '.join(missing)}")
        present = [name for name in forbidden if getattr(self, name) is not None]
        if present:
            raise ValueError(f"a {self.kind} rule must not set: {', '.join(present)}")
        return self

    def dedupe_key(self) -> tuple:
        """What makes two rules the same rule, for rejecting a payload that
        repeats one. Mirrors the three partial unique indexes."""
        if self.kind == KIND_BUILDING:
            return (KIND_BUILDING, self.building_id)
        if self.kind == KIND_FLOOR:
            return (KIND_FLOOR, self.building_id, self.floor)
        return (KIND_EVENT, self.tournament_event_id)


class ZoneMemberRead(ZoneMember):
    """A rule, plus what it names. Carries the building and event names for
    the same reason a track detail carries its building's — nothing else in a
    zone response can supply them."""

    id: int
    building_name: str | None = None
    event_name: str | None = None

    @classmethod
    def from_row(cls, row) -> "ZoneMemberRead":
        return cls(
            id=row.id,
            kind=row.kind,
            building_id=row.building_id,
            building_name=row.building.name if row.building else None,
            floor=row.floor,
            tournament_event_id=row.tournament_event_id,
            event_name=(
                row.tournament_event.display_name if row.tournament_event else None
            ),
        )


class ZoneCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    track_id: int
    name: str = Field(max_length=255)
    # The role a drag onto this zone grants. Distinct from the track's default
    # — a competition day defaults to a general volunteer role, a zone on that
    # day almost always wants Runner.
    default_role_id: int | None = None
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
    default_role_id: int | None = None
    members: list[ZoneMember] | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: str | None) -> str | None:
        return _validate_name(v) if v is not None else v


class ZoneRead(BaseModel):
    """A zone's rules *and* its contents, which are different things.

    `members` is what the TD drew — the rules. `event_ids` is what those rules
    currently resolve to, recomputed on every read (see
    core/tournament/zones.py). Nothing stores the second, and a client that
    treats `members` as the contents will be wrong the moment an event moves
    buildings.
    """

    id: int
    tournament_id: int
    track_id: int
    name: str
    default_role_id: int | None = None
    default_role_label: str | None = None
    members: list[ZoneMemberRead] = []
    event_ids: list[int] = []
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row, event_ids: list[int]) -> "ZoneRead":
        return cls(
            id=row.id,
            tournament_id=row.tournament_id,
            track_id=row.track_id,
            name=row.name,
            default_role_id=row.default_role_id,
            default_role_label=row.default_role.label if row.default_role else None,
            members=[ZoneMemberRead.from_row(m) for m in row.members],
            event_ids=event_ids,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


class ZoneCoverageRead(BaseModel):
    """One track's zones plus what they miss.

    A single response rather than a zones list and two more endpoints: the
    page needs all three at once, and the gaps are the point of looking.
    """

    track_id: int
    zones: list[ZoneRead] = []
    # Placed somewhere, but no rule reaches it — draw a rule.
    unzoned_event_ids: list[int] = []
    # No building at all — a buildings-page problem, not a zones one. Overlaps
    # the list above without being contained by it: an explicit event rule
    # zones an unplaced event just fine.
    unplaced_event_ids: list[int] = []


# ---------------------------------------------------------------------------
# Zone assignments
# ---------------------------------------------------------------------------
class ZoneAssignmentCreate(BaseModel):
    """`role_id` is optional, unlike an event assignment's.

    Omitting it takes the zone's own `default_role_id`, which is what a drag
    onto a zone sends — the TD picked the role once when they made the zone.
    A zone with no default and no role_id is a 422: the row must name a role,
    because a zone assignment with no role is a person standing somewhere for
    no stated reason.
    """

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
    def from_row(cls, row) -> "ZoneAssignmentRead":
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
