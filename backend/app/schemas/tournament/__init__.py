from __future__ import annotations
from datetime import date, datetime
from zoneinfo import available_timezones
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator

from app.schemas.tournament.role import RoleRead
from app.schemas.tournament.track import TournamentTrackCreate, TournamentTrackRead
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


class TournamentCreate(TournamentFieldValidators, BaseModel):
    """No dates, venue or divisions here — those belong to tracks, and a
    tournament is created with at least one primary track carrying them. The
    simple single-site case sends exactly one track; a multi-site regional
    sends one per venue/day.

    extra="forbid" so a caller still sending the old flat start_date/location/
    division is rejected outright rather than quietly creating a tournament
    with no schedule at all."""

    model_config = ConfigDict(extra="forbid")

    name: str
    short_name: str | None = None
    state: str
    level: str
    is_public: bool = False
    tracks: list[TournamentTrackCreate]
    # Set once from the creator's browser timezone — no update path exists,
    # this field is intentionally absent from TournamentUpdate.
    timezone: str

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, v: str) -> str:
        return _validate_timezone(v)

    @model_validator(mode="after")
    def validate_tracks(self) -> TournamentCreate:
        primary = [t for t in self.tracks if t.is_primary]
        if not primary:
            raise ValueError("a tournament needs at least one primary track")
        names = [t.name for t in self.tracks]
        if len(set(names)) != len(names):
            raise ValueError("track names must be unique within a tournament")
        # Checked here rather than on the track itself: a *new* tournament
        # can't be in the past, but an existing track legitimately can be
        # (editing a venue on a tournament already underway).
        if any(t.start_date < date.today() for t in primary):
            raise ValueError("start_date cannot be in the past")
        return self


class TournamentUpdate(TournamentFieldValidators, BaseModel):
    """Partial update — all fields optional. Dates, venue and divisions are
    absent by design; they're edited per track through /tracks/, and
    extra="forbid" turns sending one into a 422 rather than a silent no-op."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    short_name: str | None = None
    state: str | None = None
    level: str | None = None
    is_public: bool | None = None
    collect_is_over_18: bool | None = None
    collect_is_over_21: bool | None = None


class TransferOwnershipRequest(BaseModel):
    new_owner_id: int


class TournamentRead(BaseModel):
    # dates/university/location/division are derived from the tournament's
    # primary tracks, not stored — see Tournament's properties.
    # location/university resolve only when there's exactly one primary track;
    # with more than one, a caller renders `tracks` per row instead.
    id: int
    name: str
    short_name: str | None = None
    # Every day the tournament runs, not a first/last pair. A tournament with
    # Day 1 on Feb 13 and Day 2 on Feb 20 runs on two days; a range would
    # claim it also runs on the six days between them.
    dates: list[date] = []
    university: UniversityResponse | None = None
    location: str | None = None
    state: str
    level: str
    division: list[str] = []
    # Aliased to the model's `live_tracks` property so pending-delete tracks
    # never reach a non-settings audience; the raw `tracks` relationship is
    # accepted too, for the settings listing that deliberately includes them.
    tracks: list[TournamentTrackRead] = Field(
        default=[], validation_alias=AliasChoices("live_tracks", "tracks")
    )
    timezone: str
    is_public: bool
    is_verified: bool
    is_archived: bool
    owner_id: int
    roles: list[RoleRead] = []
    # TD opt-in to collecting each age threshold — see TournamentMembership's
    # age_disclosure for the per-member consent this gates.
    collect_is_over_18: bool = False
    collect_is_over_21: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def is_multi_day(self) -> bool:
        return len(self.dates) > 1


class TournamentPublic(BaseModel):
    """Shared minimal, non-sensitive tournament fields — what any viewer,
    member or not, needs to identify a tournament and decide whether to
    engage with it. No owner/roles/registration internals. Base for
    TournamentSummary (dashboard list) and JoinPreviewTournament (public
    invite preview) — deliberately has no id/target_id field since the two
    callers use different names for it."""
    name: str
    short_name: str | None = None
    # See TournamentRead.dates — a list of days, never a range.
    dates: list[date] = []
    university: UniversityResponse | None = None
    location: str | None = None
    state: str
    level: str
    division: list[str] = []
    # Carried so a card with several primary tracks can list them; a
    # single-track tournament renders the scalars above exactly as before.
    tracks: list[TournamentTrackRead] = Field(
        default=[], validation_alias=AliasChoices("live_tracks", "tracks")
    )
    is_verified: bool
    # Surfaced here (not just on TournamentRead) so an unauthenticated join
    # preview can tell whether to show the age-disclosure consent step
    # before the visitor even signs in.
    collect_is_over_18: bool = False
    collect_is_over_21: bool = False

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
