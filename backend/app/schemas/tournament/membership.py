from __future__ import annotations
from datetime import date, datetime
from typing import Any, Optional
from pydantic import BaseModel, Field, field_validator

from app.schemas.tournament.role import RoleRead
from app.schemas.tournament.track import MembershipTrackStatusRead
from app.schemas.person import PersonRefResponse
from app.schemas.user import UserFullResponse


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
    """POST .../members/me/age-disclosure/ — one answer covers both
    is_over_18 and is_over_21, there is no partial consent."""
    consent: bool


class MembershipCoordinatorUpdate(BaseModel):
    """manage_members override — day-of logistics only, not onboarding data."""
    notes: Optional[str] = None


class MembershipJoinCodeInfo(BaseModel):
    """Minimal join-code info embedded on a membership response — code/label
    plus who created it ("invited by"). Not the full JoinCodeResponse:
    app.schemas.join_code imports from this module, so importing back would
    be circular — this duplicates just what's needed. Codes are never hard-
    deleted (deactivation only flips is_active), so this is populated for
    every membership with source == "join_code"."""
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
    MembershipTrackStatusRead.from_row exists for track rows.

    `day` is the tournament-local calendar date the shift falls on. It is
    resolved server-side, not derived from `start` in the browser: a shift's
    start is an instant and the viewer's timezone need not match the
    tournament's, so a client-side conversion drifts a day near midnight.
    The members table keys its availability_day: columns off exactly this.
    """
    shift_id: int
    label: str
    start: datetime
    end: datetime
    day: str

    @classmethod
    def from_row(cls, row, tournament=None) -> "MembershipAvailabilityRead":
        """`tournament` is optional only so single-row callers can skip it —
        the fallback is a relationship hop, which costs an extra query per
        row for anyone resolving a whole roster. Pass it when you have it."""
        from app.core.tournament import tournament_local_date

        shift = row.tournament_shift
        return cls(
            shift_id=row.tournament_shift_id,
            label=shift.label,
            start=shift.start,
            end=shift.end,
            day=tournament_local_date(tournament or shift.tournament, shift.start).isoformat(),
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


def _flatten_track_statuses(v):
    """The ORM rows don't carry the track name, it's a relationship hop away.
    Routes that build this from a TournamentMembership get the flattening for
    free; anything passing already-built schema objects passes straight
    through."""
    if v and hasattr(v[0], "track"):
        return [MembershipTrackStatusRead.from_row(row) for row in v]
    return v


class MembershipBaseResponse(BaseModel):
    """The membership data the member themselves owns — what they answered,
    what they were assigned, what they're available for.

    Everything here is readable by the member on /members/me and by
    manage_members on the roster and detail routes. There is deliberately no
    member-only data: the one asymmetry in the system runs the other way
    (date_of_birth is never serialized to anyone, only the derived
    is_over_18/21 flags are). The staff-side fields — notes, provenance,
    display-config artifacts — live on MembershipFullResponse instead.

    Every field defaults, because /members/me has to answer for a user who
    may have no membership row at all (a site admin who never joined) — see
    the identity fields below, which MembershipFullResponse then narrows back
    to required.
    """
    # None only on /members/me for a caller with no membership row.
    # MembershipFullResponse re-declares all four as required: a roster row
    # that couldn't say who it was about would be meaningless.
    id: int | None = None
    # When they joined THIS tournament — distinct from user.created_at
    # (their NEXUS account age).
    created_at: datetime | None = None
    updated_at: datetime | None = None
    user: UserFullResponse | None = None

    roles: list[RoleRead] = []
    track_statuses: list[MembershipTrackStatusRead] = []

    # Omitted entirely, not nulled, unless the tournament collects the flag
    # and the member consented — see gate_age_flags.
    is_over_18: Optional[bool] = None
    is_over_21: Optional[bool] = None

    # The ORM relationships are named availability_shifts/lunch_selections —
    # validation_alias points from_attributes at the actual attribute names.
    availability: list[MembershipAvailabilityRead] = Field(default=[], validation_alias="availability_shifts")
    lunch: list[MembershipLunchRead] = Field(default=[], validation_alias="lunch_selections")
    event_preferences: list[MembershipEventPreferenceRead] = []
    # Not an ORM relationship — get_custom_form_answers runs a cross-model
    # query, so this stays empty until a route assigns it.
    custom_responses: list[MembershipCustomAnswerRead] = []

    # populate_by_name so a route can construct these by field name
    # (availability=..., lunch=...) despite the validation_alias, which
    # otherwise makes the alias the only accepted key.
    model_config = {"from_attributes": True, "populate_by_name": True}

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

    @field_validator("event_preferences", mode="before")
    @classmethod
    def _drop_unresolved_event_preferences(cls, v):
        """The ORM relationship holds one flat row per event; the grouped
        shape can only be built by build_event_preferences, which needs the
        form's options. Drop the raw rows rather than fail validation."""
        if v and hasattr(v[0], "tournament_event_id"):
            return []
        return v

    # availability rows only carry a shift id — resolve the shift's
    # label/start/end/day the same way _flatten_track_statuses resolves a
    # track's name off the raw ORM rows.
    @field_validator("availability", mode="before")
    @classmethod
    def _resolve_availability(cls, v):
        if v and hasattr(v[0], "tournament_shift_id"):
            return [MembershipAvailabilityRead.from_row(row) for row in v]
        return v


class MembershipFullResponse(MembershipBaseResponse):
    """Manager-facing view of one membership. The roster row and the detail
    panel are the same shape, narrowed by the `fields` query parameter rather
    than by a second schema. Only reachable with manage_members."""
    # Required here, unlike on the base — this route always has a row.
    id: int
    created_at: datetime
    updated_at: datetime
    user: UserFullResponse

    tournament_id: int
    source: str
    # Resolved server-side — see MembershipJoinCodeInfo. None when source
    # isn't "join_code". Supersedes the bare join_code_id FK.
    join_code: MembershipJoinCodeInfo | None = None
    # null/"consented"/"declined" — lets a TD who opts into seeing declined
    # members (?include_declined=true) tell them apart from active ones.
    age_disclosure: Optional[str] = None
    notes: Optional[str] = None
    # Sections the surface's display config emptied out — set by
    # apply_display_config, never by the ORM. The panel renders a section even
    # when a member has no data for it ("No info yet"), so it needs this to
    # tell that apart from a section the TD turned off. Reports display_config
    # removals only: a group the client never asked for via `fields` is absent
    # from the response, which is not the same as hidden.
    hidden_sections: list[str] = []


class MembershipMeResponse(MembershipBaseResponse):
    """GET .../members/me/ — the caller's own membership plus what they may
    do here. The membership data itself is the base; everything added below
    answers "who am I in this tournament", which is meaningless for anyone
    else and so has no place on the manager view.

    The membership data itself is identical to what manage_members reads
    about someone else — a member is not shown less about themselves than a
    coordinator is. The one asymmetry runs the other way: date_of_birth is
    serialized to nobody, only the derived is_over_18/21 flags are."""
    is_owner: bool = False
    permissions: list[str] = []
    # True when the tournament collects an age flag and this member hasn't
    # answered yet (age_disclosure is null) — drives the blocking consent
    # modal for existing members after a TD turns collection on. False (not
    # just omitted) once answered either way, and always False with no
    # membership row — nothing to consent to.
    needs_age_consent: bool = False
