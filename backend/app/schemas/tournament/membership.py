from __future__ import annotations
from datetime import date, datetime
from typing import Any, Optional
from pydantic import BaseModel, Field, field_validator

from app.schemas.tournament.role import RoleRead
from app.schemas.tournament.track import MembershipTrackStatusRead
from app.schemas.user import UserFullResponse, UserSlimResponse


class MembershipMeUpdate(BaseModel):
    """Self-service update — the fields a volunteer fills out during onboarding.

    Onboarding data (role/event preference, availability, lunch) now comes
    through the native form response flow (see app/core/form/write_through.py),
    not this endpoint — no self-service fields remain here.

    manage_members cannot write these on someone else's behalf; see
    MembershipCoordinatorUpdate for the staff-side fields.
    """
    pass


class AgeDisclosureRequest(BaseModel):
    """POST .../memberships/me/age-disclosure/ — one answer covers both
    is_over_18 and is_over_21, there is no partial consent."""
    consent: bool


class MembershipCoordinatorUpdate(BaseModel):
    """manage_members override — day-of logistics only, not onboarding data."""
    notes: Optional[str] = None


class MembershipJoinCodeInfo(BaseModel):
    """Minimal join-code info embedded on a membership response — code/label
    plus who created it ("invited by"). Not the full JoinCodeResponse:
    app.schemas.join_code imports MembershipSlimResponse from this module, so
    importing back would be circular — this duplicates just what's needed.
    Codes are never hard-deleted (deactivation only flips is_active), so this
    is populated for every membership with source == "join_code"."""
    id: int
    code: str
    label: str | None = None
    # The creator's membership in this tournament — falls back to the bare
    # user when they have none. Resolved server-side, same pattern as
    # JoinCodeResponse.creator / AuditLogEntry.actor.
    creator: "MembershipSlimResponse | UserSlimResponse"

    model_config = {"from_attributes": True}


class MembershipEventPreferenceEventRead(BaseModel):
    """One event within a preference group — same {id, name, division} shape
    resolve_field_options gives an event_preference option's events, so a
    renderer can reuse the same event-display component either way."""
    id: int
    name: str | None = None
    division: str | None = None
    rank: int | None = None


class MembershipEventPreferenceRead(BaseModel):
    """One event_preference_{suffix} question's answer, grouped by key with
    its events resolved. Each suffix is its own independent axis — see
    form-question-types-reference.md — so this is a list, not a single
    preference."""
    key: str
    events: list[MembershipEventPreferenceEventRead]

    @classmethod
    def group_rows(cls, rows) -> list["MembershipEventPreferenceRead"]:
        """Groups flat TournamentMembershipEventPreference rows (one per
        event) into one entry per key, ordered by key then by rank (nulls
        last) then event id within each key."""
        by_key: dict[str, list] = {}
        for row in rows:
            by_key.setdefault(row.key, []).append(row)
        return [
            cls(
                key=key,
                events=[
                    MembershipEventPreferenceEventRead(
                        id=row.tournament_event_id,
                        name=row.tournament_event.name,
                        division=row.tournament_event.division,
                        rank=row.rank,
                    )
                    for row in sorted(
                        by_key[key],
                        key=lambda r: (r.rank is None, r.rank or 0, r.tournament_event_id),
                    )
                ],
            )
            for key in sorted(by_key)
        ]


class MembershipAvailabilityRead(BaseModel):
    """One availability_{date} answer, resolved to its shift's label/start/end
    — the row itself only carries the shift id, same reason
    MembershipTrackStatusRead.from_row exists for track rows."""
    shift_id: int
    label: str
    start: datetime
    end: datetime

    @classmethod
    def from_row(cls, row) -> "MembershipAvailabilityRead":
        return cls(
            shift_id=row.tournament_shift_id,
            label=row.tournament_shift.label,
            start=row.tournament_shift.start,
            end=row.tournament_shift.end,
        )


class MembershipLunchRead(BaseModel):
    """One lunch_{date}_{category} answer. Fields already match the ORM row
    1:1, so from_attributes handles this without a resolver classmethod."""
    date: date
    category: str
    label: str

    model_config = {"from_attributes": True}


class MembershipCustomAnswerRead(BaseModel):
    """One answer to a non-reserved (not availability_/lunch_/track_status_/
    event_preference_) form field — everything that doesn't have a dedicated
    structural field of its own. Built by
    app.core.tournament.memberships.get_custom_form_answers, which runs the
    cross-model query this can't do from a plain TournamentMembership
    relationship alone."""
    form_title: str
    field_label: str
    question_type: str
    value: Any


class _MembershipRolesMixin(BaseModel):
    """Shared roles handling for response schemas.

    TournamentMembership.roles is a list of TournamentMembershipRole join
    rows, not TournamentRole rows — unwrap to the underlying role so this
    serializes as list[RoleRead].
    """
    roles: list[RoleRead] = []

    @field_validator("roles", mode="before")
    @classmethod
    def _unwrap_roles(cls, v):
        if v and hasattr(v[0], "role"):
            return [mr.role for mr in v]
        return v

    model_config = {"from_attributes": True}


class MembershipSlimResponse(_MembershipRolesMixin):
    """List view — members page roster. No onboarding/logistics fields."""
    id: int
    source: str
    # Resolved server-side — see MembershipJoinCodeInfo. None when source
    # isn't "join_code". Supersedes the bare join_code_id FK.
    join_code: MembershipJoinCodeInfo | None = None
    # When they joined THIS tournament — distinct from user.created_at
    # (their NEXUS account age).
    created_at: datetime
    updated_at: datetime

    user: UserSlimResponse


class MembershipMeResponse(_MembershipRolesMixin):
    """GET .../memberships/me/ — current user's membership + effective
    permissions. Enrichment fields mirror MembershipFullResponse's (same
    data, same shapes) so a member can read everything about their own
    membership that manage_members can read about someone else's — just
    readable without that permission."""
    membership_id: int | None
    is_owner: bool
    permissions: list[str] = []
    is_over_18: Optional[bool] = None
    is_over_21: Optional[bool] = None
    # Their own per-track statuses — readable without manage_members, unlike
    # the tournament-wide roster.
    track_statuses: list[MembershipTrackStatusRead] = []
    event_preferences: list[MembershipEventPreferenceRead] = []
    availability: list[MembershipAvailabilityRead] = []
    lunch: list[MembershipLunchRead] = []
    custom_responses: list[MembershipCustomAnswerRead] = []
    # True when the tournament collects an age flag and this member hasn't
    # answered yet (age_disclosure is null) — drives the blocking consent
    # modal for existing members after a TD turns collection on. False (not
    # just omitted) once answered either way, and always False with no
    # membership row — nothing to consent to.
    needs_age_consent: bool = False


class MembershipFullResponse(_MembershipRolesMixin):
    """Detail view — the expanded side panel for a single member."""
    id: int
    tournament_id: int
    notes: Optional[str] = None
    source: str
    join_code: MembershipJoinCodeInfo | None = None

    is_over_18: Optional[bool] = None
    is_over_21: Optional[bool] = None

    created_at: datetime
    updated_at: datetime

    track_statuses: list[MembershipTrackStatusRead] = []
    event_preferences: list[MembershipEventPreferenceRead] = []
    # The ORM relationships are named availability_shifts/lunch_selections —
    # validation_alias points from_attributes at the actual attribute names.
    availability: list[MembershipAvailabilityRead] = Field(default=[], validation_alias="availability_shifts")
    lunch: list[MembershipLunchRead] = Field(default=[], validation_alias="lunch_selections")
    # Not a TournamentMembership relationship — populated by the route via
    # get_custom_form_answers after the rest of this response is built.
    custom_responses: list[MembershipCustomAnswerRead] = []

    user: UserFullResponse

    # Same shape problem as _unwrap_roles: the ORM rows don't carry the track
    # name, it's a relationship hop away. Routes that build this from a
    # TournamentMembership get the flattening for free; anything passing
    # already-built schema objects passes straight through.
    @field_validator("track_statuses", mode="before")
    @classmethod
    def _flatten_track_statuses(cls, v):
        if v and hasattr(v[0], "track"):
            return [MembershipTrackStatusRead.from_row(row) for row in v]
        return v

    # Same treatment for event preferences — the flat per-event rows need
    # grouping by key before they match this schema's shape.
    @field_validator("event_preferences", mode="before")
    @classmethod
    def _group_event_preferences(cls, v):
        if v and hasattr(v[0], "tournament_event_id"):
            return MembershipEventPreferenceRead.group_rows(v)
        return v

    # availability rows only carry a shift id — resolve the shift's
    # label/start/end the same way _flatten_track_statuses resolves a track's
    # name off the raw ORM rows.
    @field_validator("availability", mode="before")
    @classmethod
    def _resolve_availability(cls, v):
        if v and hasattr(v[0], "tournament_shift_id"):
            return [MembershipAvailabilityRead.from_row(row) for row in v]
        return v
