from __future__ import annotations
from datetime import date, datetime
from typing import Any, Optional
from pydantic import BaseModel, Field, field_validator

from app.schemas.tournament.role import RoleRead
from app.schemas.tournament.track import MembershipTrackStatusRead
from app.schemas.person import PersonRefResponse
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


class MembershipAvailabilityUpdate(BaseModel):
    """Self-service availability — the member's whole set of shifts for this
    tournament, not a delta. A member editing their own page is stating what
    they're available for now, so anything absent is a withdrawal; the
    per-day scoping write-through needs (see sync_availability) exists to
    keep two forms from treading on each other, which doesn't apply here."""
    shift_ids: list[int] = []


class MembershipTrackStatusUpdate(BaseModel):
    """Self-service track status for one track.

    Which transitions are allowed is not this schema's business — see the
    route. Briefly: opting out is always the member's own call, opting in to
    `confirmed` needs the track's allow_self_confirm."""
    status: str

    @field_validator("status")
    @classmethod
    def _known_status(cls, value: str) -> str:
        from app.core.form.write_through import TRACK_STATUSES

        if value not in TRACK_STATUSES:
            raise ValueError(f"status must be one of {', '.join(TRACK_STATUSES)}")
        return value


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
    creator: PersonRefResponse

    model_config = {"from_attributes": True}


class MembershipEventPreferenceEventRead(BaseModel):
    """One event within a preference group — same {id, name, division} shape
    resolve_field_options gives an event_preference option's events, so a
    renderer can reuse the same event-display component either way."""
    id: int
    name: str | None = None
    division: str | None = None
    rank: int | None = None


class MembershipEventPreferenceOptionRead(BaseModel):
    """One picked option of an event_preference question, with the events it
    groups nested inside. The DB stores one flat row per event; the panel
    wants the option the member actually chose, since a single option can
    group 20+ events. Built by app.core.tournament.memberships.
    build_event_preferences — the reverse mapping needs the form's options,
    so it can't be derived from the membership rows alone."""
    # None only for an event that matched no option at all — see is_archived.
    option_id: str | None = None
    label: str
    rank: int | None = None
    # True when the option (or its whole field) has been archived, or when no
    # option matched. Flags an answer the TD's current form can no longer
    # produce, so the UI can prompt for a re-submit.
    is_archived: bool = False
    events: list[MembershipEventPreferenceEventRead]

    model_config = {"from_attributes": True}


class MembershipEventPreferenceRead(BaseModel):
    """One event_preference_{suffix} question's answer, grouped by key then by
    the option picked. Each suffix is its own independent axis — see
    form-question-types-reference.md — so this is a list, not a single
    preference."""
    key: str
    options: list[MembershipEventPreferenceOptionRead]

    model_config = {"from_attributes": True}


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
    1:1, so from_attributes handles this without a resolver classmethod.

    `value` rather than `label`: the row carries both, and value is the short
    canonical form ("Sofritas") while label is the full option text the form
    showed ("Sofritas (Vegan)") — the panel renders these as badges, where
    the short form is what fits."""
    date: date
    category: str
    value: str
    # The source question's type — a picked option and a typed answer land in
    # identical columns, so this is the only thing that tells a renderer
    # which it's looking at. Resolved by build_lunch, which has the field;
    # None when the field is gone (deleted form) or the response was built
    # straight from the ORM rows.
    question_type: str | None = None

    model_config = {"from_attributes": True}


class MembershipTableShiftRead(BaseModel):
    """One availability shift as the members table needs it — the label to put
    on a badge, plus the tournament-local day that decides which column it
    belongs in."""
    shift_id: int
    label: str
    day: str


class MembershipCustomAnswerRead(BaseModel):
    """One answer to a non-reserved (not availability_/lunch_/track_status_/
    event_preference_) form field — everything that doesn't have a dedicated
    structural field of its own. Built by
    app.core.tournament.memberships.get_custom_form_answers, which runs the
    cross-model query this can't do from a plain TournamentMembership
    relationship alone."""
    form_title: str
    field_label: str
    # The panel labels answers by key, not by the question's full sentence —
    # see the members-panel display config, which does the same.
    field_key: str
    question_type: str
    value: Any
    # Not part of the original 1.2 shape — added for 3.3's display_config
    # "form_field:{field_id}" hidden-item matching, which needs a stable id
    # to key on (field_label is TD-editable display text, not stable).
    field_id: str


class _MembershipRolesMixin(BaseModel):
    """Roles unwrapping on its own, for the one response that shares nothing
    else — MembershipMeResponse is keyed by permissions rather than by the
    membership row, so it has no id/created_at to inherit."""
    roles: list[RoleRead] = []

    model_config = {"from_attributes": True}

    @field_validator("roles", mode="before")
    @classmethod
    def _unwrap_roles(cls, v):
        if v and hasattr(v[0], "role"):
            return [mr.role for mr in v]
        return v


class _MembershipResponseBase(_MembershipRolesMixin):
    """What every membership response carries, whichever view it is.

    Slim (roster) and Full (detail panel) genuinely differ — the roster is
    every member in the tournament, so it must not carry a whole user profile
    and every onboarding answer per row — but the identity of the membership
    itself is the same either way, and was previously declared twice.
    """
    id: int
    source: str
    # Resolved server-side — see MembershipJoinCodeInfo. None when source
    # isn't "join_code". Supersedes the bare join_code_id FK.
    join_code: MembershipJoinCodeInfo | None = None
    # When they joined THIS tournament — distinct from user.created_at
    # (their NEXUS account age).
    created_at: datetime
    updated_at: datetime

    track_statuses: list[MembershipTrackStatusRead] = []

    # Omitted entirely, not nulled, unless the tournament collects the flag
    # and the member consented — see gate_age_flags.
    is_over_18: Optional[bool] = None
    is_over_21: Optional[bool] = None

    # Always populated on the detail view; on the roster only when a table
    # column asks for them (see enrich_table_columns), since a roster is every
    # member and loading answers nobody displays is waste on every page load.
    lunch: list[MembershipLunchRead] = []
    custom_responses: list[MembershipCustomAnswerRead] = []

    model_config = {"from_attributes": True}

    @field_validator("roles", mode="before")
    @classmethod
    def _unwrap_roles(cls, v):
        if v and hasattr(v[0], "role"):
            return [mr.role for mr in v]
        return v

    @field_validator("track_statuses", mode="before")
    @classmethod
    def _validate_track_statuses(cls, v):
        return _flatten_track_statuses(v)


def _flatten_track_statuses(v):
    """Shared by MembershipSlimResponse and MembershipFullResponse: the ORM
    rows don't carry the track name, it's a relationship hop away. Routes
    that build this from a TournamentMembership get the flattening for free;
    anything passing already-built schema objects passes straight through."""
    if v and hasattr(v[0], "track"):
        return [MembershipTrackStatusRead.from_row(row) for row in v]
    return v


class MembershipSlimResponse(_MembershipResponseBase):
    """List view — members page roster. No onboarding/logistics fields beyond
    what a configured table column asks for."""
    # null/"consented"/"declined" — surfaced so a TD who opts into seeing
    # declined members (GET .../memberships/?include_declined=true) can tell
    # them apart from active ones; excluded from the roster by default.
    age_disclosure: Optional[str] = None

    # ---- Optional table-column data -------------------------------------
    # Like `lunch`/`custom_responses` on the base: loaded only when a column
    # asks for it.
    shirt_size: Optional[str] = None
    # The shifts this member is available for, each tagged with the
    # tournament-local day its availability_day: column keys by. The day is
    # resolved server-side rather than derived from a timestamp in the
    # browser: a shift's start is an instant, and the viewer's timezone need
    # not match the tournament's.
    availability_shifts: list["MembershipTableShiftRead"] = []

    user: UserSlimResponse

    # `availability_shifts` is also the name of the ORM relationship holding
    # the raw join rows, so from_attributes would populate this with those
    # instead of the resolved shape. Drop them; enrich_table_columns assigns
    # the real value, and only when a column asks for it.
    @field_validator("availability_shifts", mode="before")
    @classmethod
    def _drop_unresolved_availability_shifts(cls, v):
        if v and hasattr(v[0], "tournament_shift_id"):
            return []
        return v


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


class MembershipFullResponse(_MembershipResponseBase):
    """Detail view — the expanded side panel for a single member."""
    tournament_id: int
    notes: Optional[str] = None

    event_preferences: list[MembershipEventPreferenceRead] = []
    # The ORM relationships are named availability_shifts/lunch_selections —
    # validation_alias points from_attributes at the actual attribute names.
    # (The base declares `lunch` unaliased for the roster, which assigns it
    # rather than reading it off the ORM.)
    availability: list[MembershipAvailabilityRead] = Field(default=[], validation_alias="availability_shifts")
    lunch: list[MembershipLunchRead] = Field(default=[], validation_alias="lunch_selections")
    # Sections the surface's display config emptied out — set by
    # apply_display_config, never by the ORM. The panel renders a section even
    # when a member has no data for it ("No info yet"), so it needs this to
    # tell that apart from a section the TD turned off.
    hidden_sections: list[str] = []

    user: UserFullResponse

    @field_validator("event_preferences", mode="before")
    @classmethod
    def _drop_unresolved_event_preferences(cls, v):
        if v and hasattr(v[0], "tournament_event_id"):
            return []
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
