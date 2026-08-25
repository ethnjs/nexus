from __future__ import annotations
from datetime import date, datetime
from zoneinfo import available_timezones
from pydantic import BaseModel, computed_field, field_validator, model_validator

from app.schemas.tournament.role import RoleRead
from app.schemas.university import UniversityResponse

VALID_LEVELS = {"regionals", "state", "nationals", "invitational"}
VALID_DIVISIONS = {"A", "B", "C"}
VALID_STATES = {
    "Alabama", "Alaska", "Arizona", "Arkansas", "Colorado", "Connecticut",
    "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana",
    "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
    "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri",
    "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
    "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
    "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
    "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
    "Washington", "West Virginia", "Wisconsin", "Wyoming",
    "Southern California", "Northern California",
}


def _validate_name(v: str) -> str:
    if any(char.isdigit() for char in v):
        raise ValueError("name must not contain numbers (year is derived from start_date)")
    return v


def _validate_state(v: str) -> str:
    if v not in VALID_STATES:
        raise ValueError(f"state must be one of: {sorted(VALID_STATES)}")
    return v


def _validate_level(v: str) -> str:
    if v not in VALID_LEVELS:
        raise ValueError(f"level must be one of: {sorted(VALID_LEVELS)}")
    return v


def _validate_division(v: list[str]) -> list[str]:
    if not v:
        raise ValueError("division must have at least one entry")
    invalid = set(v) - VALID_DIVISIONS
    if invalid:
        raise ValueError(f"division must be a subset of: {sorted(VALID_DIVISIONS)}")
    return sorted(set(v))


def _validate_timezone(v: str) -> str:
    if v not in available_timezones():
        raise ValueError("timezone must be a valid IANA timezone name")
    return v


class TournamentFieldValidators:
    """Shared field validators for TournamentCreate/TournamentUpdate. Mixed in
    rather than inherited from a common BaseModel because the two differ on
    which fields are required — see Pydantic's "validators in reusable
    mixins" pattern. Every field here is optional on at least one of the two
    models, so validators uniformly guard for None (a value Create's required
    fields will never actually receive)."""

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        return _validate_name(v) if v is not None else v

    @field_validator("state")
    @classmethod
    def validate_state(cls, v: str | None) -> str | None:
        return _validate_state(v) if v is not None else v

    @field_validator("level")
    @classmethod
    def validate_level(cls, v: str | None) -> str | None:
        return _validate_level(v) if v is not None else v

    @field_validator("division")
    @classmethod
    def validate_division(cls, v: list[str] | None) -> list[str] | None:
        return _validate_division(v) if v is not None else v


class TournamentCreate(TournamentFieldValidators, BaseModel):
    name: str
    short_name: str | None = None
    start_date: date
    end_date: date
    university_id: int | None = None
    location: str | None = None
    state: str
    level: str
    division: list[str]
    is_public: bool = False
    # Set once from the creator's browser timezone — no update path exists,
    # this field is intentionally absent from TournamentUpdate.
    timezone: str

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, v: str) -> str:
        return _validate_timezone(v)

    @model_validator(mode="after")
    def validate_dates(self) -> TournamentCreate:
        if self.end_date < self.start_date:
            raise ValueError("end_date must be after start_date")
        if self.start_date < date.today():
            raise ValueError("start_date cannot be in the past")
        return self

    @model_validator(mode="after")
    def validate_source(self) -> TournamentCreate:
        if bool(self.university_id) == bool(self.location):
            raise ValueError("Tournament must have exactly one of university_id or location, not both.")
        return self


class TournamentUpdate(TournamentFieldValidators, BaseModel):
    """Partial update — all fields optional."""
    name: str | None = None
    short_name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    university_id: int | None = None
    location: str | None = None
    state: str | None = None
    level: str | None = None
    division: list[str] | None = None
    is_public: bool | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> TournamentUpdate:
        if self.start_date is not None and self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("end_date must be after start_date")
        if self.start_date is not None and self.start_date < date.today():
            raise ValueError("start_date cannot be in the past")
        return self

    @model_validator(mode="after")
    def validate_source(self) -> TournamentUpdate:
        if self.university_id is not None and self.location is not None:
            raise ValueError("Tournament must have exactly one of university_id or location, not both.")
        return self


class TransferOwnershipRequest(BaseModel):
    new_owner_id: int


class TournamentRead(BaseModel):
    id: int
    name: str
    short_name: str | None = None
    start_date: date
    end_date: date
    university: UniversityResponse | None = None
    location: str | None = None
    state: str
    level: str
    division: list[str]
    timezone: str
    is_public: bool
    is_verified: bool
    is_archived: bool
    owner_id: int
    roles: list[RoleRead] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def is_multi_day(self) -> bool:
        return self.end_date > self.start_date


class TournamentPublic(BaseModel):
    """Shared minimal, non-sensitive tournament fields — what any viewer,
    member or not, needs to identify a tournament and decide whether to
    engage with it. No owner/roles/registration internals. Base for
    TournamentSummary (dashboard list) and JoinPreviewTournament (public
    invite preview) — deliberately has no id/target_id field since the two
    callers use different names for it."""
    name: str
    short_name: str | None = None
    start_date: date
    end_date: date
    university: UniversityResponse | None = None
    location: str | None = None
    state: str
    level: str
    division: list[str]
    is_verified: bool

    model_config = {"from_attributes": True}


class TournamentSummary(TournamentPublic):
    """GET /tournaments/me/ — lightweight card view, no roles/owner."""
    id: int
    is_public: bool
    is_archived: bool
    event_count: int
    volunteer_count: int
    created_at: datetime
    updated_at: datetime
