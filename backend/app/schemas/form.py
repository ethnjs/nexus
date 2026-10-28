from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.person import PersonNameRef, PersonRefResponse

# ---------------------------------------------------------------------------
# FormField.config schemas — one per question_type, shape enforced per
# backend/docs/form-question-types-reference.md. These cover structural shape only
# (required keys, types, per-option uniqueness, ranks <= options); DB-backed
# checks (next_field_id resolving to a real field, availability options
# resolving to a real TournamentShift, reserved field_key pairing) stay in
# app/core/form/validation.py since they need a Session, not just the dict.
# ---------------------------------------------------------------------------


def _unique_option_fields(options: list) -> list:
    """option_id must be unique within a field's option list — it's the
    durable identity behind edit-lifecycle archiving, write-through and
    branching match, so a collision there really would make selection
    ambiguous.

    `value` is only checked when it's a plain string. On a freeform question
    that string *is* the stored answer, so two options sharing it can't be
    told apart. On an entity-backed reserved field_key it isn't: the answer
    records option_id, and value is the set of shifts/events the option
    groups. Two options grouping the same entities are redundant, not
    ambiguous — and requiring them to differ would reject the ordinary
    in-progress state where several options have nothing picked yet and are
    all still empty."""
    seen_ids, seen_values = set(), set()
    for option in options:
        if option.option_id in seen_ids:
            raise ValueError(f"duplicate option_id '{option.option_id}'")
        seen_ids.add(option.option_id)
        if isinstance(option.value, str):
            if option.value in seen_values:
                raise ValueError(f"duplicate option value '{option.value}'")
            seen_values.add(option.value)
    return options


VALID_TRACK_STATUSES = {"interested", "confirmed", "declined"}


class TrackStatusAssignment(BaseModel):
    """One track status attached to a selectable option."""

    model_config = ConfigDict(extra="forbid")

    id: int = Field(gt=0)
    status: Literal["interested", "confirmed", "declined"]


def _unique_track_statuses(assignments: list[TrackStatusAssignment]) -> list[TrackStatusAssignment]:
    track_ids = [assignment.id for assignment in assignments]
    if len(track_ids) != len(set(track_ids)):
        raise ValueError("duplicate track_id in track_statuses")
    return assignments


class AvailabilityTrackStatusValue(BaseModel):
    """Raw builder value for an availability option that also updates track
    statuses: the shifts it groups, plus a status for any of the tournament's
    tracks — not only the one in the field's key (e.g. "Can't make Day 1"
    declining Day 1 while marking interest in the Test Writing track)."""

    model_config = ConfigDict(extra="forbid")

    shift_ids: list[int]
    track_statuses: list[TrackStatusAssignment] = Field(default_factory=list)

    @field_validator("track_statuses")
    @classmethod
    def _unique(cls, assignments: list[TrackStatusAssignment]) -> list[TrackStatusAssignment]:
        return _unique_track_statuses(assignments)


class PlainOption(BaseModel):
    """An option with no branching — multi_select_checkbox, ranked_choice.
    extra='forbid' rejects a stray next_field_id/action on these types.
    value is usually TD-facing display text, but for an entity-backed
    reserved field_key it's list[int] instead — the ids of the underlying
    entities (TournamentShifts, TournamentEvents, ...) this option groups
    together; the client is responsible for interpreting which shape to
    expect based on the field's field_key."""

    model_config = ConfigDict(extra="forbid")
    option_id: str = Field(min_length=1)
    value: str | list[int] | list[TrackStatusAssignment] | AvailabilityTrackStatusValue
    label: str = Field(min_length=1)
    is_archived: bool = False


class BranchingOption(BaseModel):
    """An option that may carry branching — single_select_radio/dropdown only.
    See PlainOption for value's dual str/list[int] shape."""

    model_config = ConfigDict(extra="forbid")
    option_id: str = Field(min_length=1)
    value: str | list[int] | list[TrackStatusAssignment] | AvailabilityTrackStatusValue
    label: str = Field(min_length=1)
    is_archived: bool = False
    next_field_id: str | None = None
    action: Literal["submit_form"] | None = None

    @model_validator(mode="after")
    def _mutually_exclusive(self):
        if self.next_field_id is not None and self.action is not None:
            raise ValueError("an option cannot have both next_field_id and action")
        return self


class AcknowledgmentConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    required: bool
    confirm_label: str = Field(min_length=1)


class SingleSelectRadioConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    required: bool
    # Client-side render choice — long option labels don't fit ButtonGroup's
    # pill layout well, so the TD can fall back to a plain radio list.
    # Dropdown has no equivalent (it's always a closed Dropdown control, not
    # a style choice), so this doesn't exist on that config.
    display_style: Literal["buttons", "list"] = "list"
    track_status_enabled: bool = False
    options: list[BranchingOption]

    @field_validator("options")
    @classmethod
    def _unique_values(cls, options: list[BranchingOption]) -> list[BranchingOption]:
        return _unique_option_fields(options)


class SingleSelectDropdownConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    required: bool
    options: list[BranchingOption]

    @field_validator("options")
    @classmethod
    def _unique_values(cls, options: list[BranchingOption]) -> list[BranchingOption]:
        return _unique_option_fields(options)


class MultiSelectCheckboxConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    required: bool
    display_style: Literal["buttons", "list"] = "list"
    track_status_enabled: bool = False
    options: list[PlainOption]

    @field_validator("options")
    @classmethod
    def _unique_values(cls, options: list[PlainOption]) -> list[PlainOption]:
        return _unique_option_fields(options)


class RankedChoiceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    required: bool
    ranks: int = Field(gt=0)
    allow_duplicates: bool
    options: list[PlainOption]

    @field_validator("options")
    @classmethod
    def _unique_values(cls, options: list[PlainOption]) -> list[PlainOption]:
        return _unique_option_fields(options)

    @model_validator(mode="after")
    def _ranks_within_options(self):
        if self.ranks > len(self.options):
            raise ValueError("ranks cannot exceed the number of options")
        return self


class TextConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    required: bool
    max_length: int = Field(gt=0)


QUESTION_TYPE_CONFIG_SCHEMAS: dict[str, type[BaseModel]] = {
    "acknowledgment": AcknowledgmentConfig,
    "single_select_radio": SingleSelectRadioConfig,
    "single_select_dropdown": SingleSelectDropdownConfig,
    "multi_select_checkbox": MultiSelectCheckboxConfig,
    "ranked_choice": RankedChoiceConfig,
    "short_text": TextConfig,
    "long_text": TextConfig,
}


# ---------------------------------------------------------------------------
# Form Field Schemas
# ---------------------------------------------------------------------------


class FormFieldRead(BaseModel):
    id: str
    form_id: str
    field_key: str
    order: int
    label: str
    description: str | None = None
    question_type: str
    is_archived: bool = False
    config: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BulkFieldEntry(BaseModel):
    """One entry in a PUT /forms/{form_id}/fields/ payload. `id` absent
    means "create"; `id` present must match a currently-live field on this
    form. `field_key` is required on create; on an update, omitting it leaves
    the existing key alone while sending one renames the field."""

    id: str | None = None
    field_key: str | None = None
    label: str
    description: str | None = None
    question_type: str
    config: dict[str, Any] | None = None


class BulkFieldsUpdate(BaseModel):
    fields: list[BulkFieldEntry]


# ---------------------------------------------------------------------------
# Tournament form prerequisites
# ---------------------------------------------------------------------------


class RolePrerequisite(BaseModel):
    """Passes when the member holds any (or all) of `ids`; `inverse` flips the result."""

    model_config = ConfigDict(extra="forbid")

    ids: list[int] = Field(min_length=1)
    match: Literal["any", "all"] = "any"
    inverse: bool = False

    @field_validator("ids")
    @classmethod
    def _positive_unique_ids(cls, values: list[int]) -> list[int]:
        if any(value <= 0 for value in values):
            raise ValueError("ids must contain positive integers")
        if len(values) != len(set(values)):
            raise ValueError("ids must not contain duplicates")
        return values


class TournamentFormPrerequisites(BaseModel):
    """Role conditions a member must all pass to see and answer a tournament form."""

    model_config = ConfigDict(extra="forbid")

    roles: list[RolePrerequisite] = []


# ---------------------------------------------------------------------------
# Form Schemas
# ---------------------------------------------------------------------------


class FormRead(BaseModel):
    id: str
    name: str
    title: str | None = None
    description: str | None = None
    status: Literal["draft", "published", "archived"]
    owner_type: Literal["tournament", "chapter"]
    tournament_id: int | None = None
    # Null for a chapter form, which has no tournament to be archived.
    tournament_is_archived: bool | None = None
    chapter_id: int | None = None
    # Null once the creator's account is deleted.
    created_by: int | None = None
    allow_response_edits: bool = False
    created_at: datetime
    updated_at: datetime
    response_count: int = 0
    prerequisites: TournamentFormPrerequisites | None = None
    fields: list[FormFieldRead] = []

    model_config = ConfigDict(from_attributes=True)


# Forms-list rows (GET /tournaments/{id}/forms/, /chapters/{id}/forms/) don't
# need each form's full field list — field_count is enough for the list UI,
# and skipping `fields` avoids serializing every field/option on every form
# just to render a table row.
class FormListRead(BaseModel):
    id: str
    name: str
    title: str | None = None
    description: str | None = None
    status: Literal["draft", "published", "archived"]
    owner_type: Literal["tournament", "chapter"]
    tournament_id: int | None = None
    chapter_id: int | None = None
    # Resolved server-side to the creator's membership in the form's own
    # tournament/chapter, falling back to the bare user when they have none
    # (e.g. a site admin acting without ever joining) — same pattern as
    # JoinCodeResponse.creator.
    creator: PersonRefResponse
    allow_response_edits: bool = False
    created_at: datetime
    updated_at: datetime
    response_count: int = 0
    prerequisites: TournamentFormPrerequisites | None = None

    model_config = ConfigDict(from_attributes=True)


class MemberFormRead(BaseModel):
    """A member's completed or currently available tournament form."""

    id: str
    name: str
    title: str | None = None
    description: str | None = None
    status: Literal["draft", "published", "archived"]
    is_onboarding: bool
    completed: bool
    eligible: bool
    # Whether a completed response can be revised — the overview's Edit button.
    allow_response_edits: bool = False

    model_config = ConfigDict(from_attributes=True)


class FormCreate(BaseModel):
    name: str
    title: str | None = None
    description: str | None = None
    owner_type: Literal["tournament", "chapter"]
    tournament_id: int | None = None
    chapter_id: int | None = None

    @model_validator(mode="after")
    def _require_matching_owner(self):
        if self.owner_type == "tournament":
            if self.tournament_id is None or self.chapter_id is not None:
                raise ValueError("owner_type 'tournament' requires tournament_id and no chapter_id")
        else:
            if self.chapter_id is None or self.tournament_id is not None:
                raise ValueError("owner_type 'chapter' requires chapter_id and no tournament_id")
        return self


class FormUpdate(BaseModel):
    name: str | None = None
    title: str | None = None
    description: str | None = None
    status: Literal["draft", "published", "archived"] | None = None
    allow_response_edits: bool | None = None


# ---------------------------------------------------------------------------
# Form Response / Answer Schemas
# ---------------------------------------------------------------------------


class FormAnswerCreate(BaseModel):
    field_id: str
    value: Any


class FormAnswerRead(BaseModel):
    id: str
    field_id: str
    value: Any

    model_config = ConfigDict(from_attributes=True)


class FormResponseCreate(BaseModel):
    answers: list[FormAnswerCreate]


class FormResponseRead(BaseModel):
    id: str
    form_id: str
    user_id: int
    submitted_at: datetime
    updated_at: datetime
    answers: list[FormAnswerRead] = []

    model_config = ConfigDict(from_attributes=True)


class FormRespondentRead(PersonNameRef):
    """Who submitted a response. Email rides along for the managers' search
    and follow-up — this only ever reaches people with manage access."""

    email: str


class FormResponseManagerRead(FormResponseRead):
    """GET /forms/{form_id}/responses/ — the managers' audience. Adds who
    answered; a respondent reading their own response already knows."""

    respondent: FormRespondentRead
