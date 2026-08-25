from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.user import UserSlimResponse
from app.schemas.tournament.membership import MembershipSlimResponse
from app.schemas.chapter.membership import ChapterMemberResponse

# ---------------------------------------------------------------------------
# FormField.config schemas — one per question_type, shape enforced per
# form-question-types-reference.md. These cover structural shape only
# (required keys, types, per-option uniqueness, ranks <= options); DB-backed
# checks (next_field_id resolving to a real field, availability options
# resolving to a real TournamentShift, reserved field_key pairing) stay in
# app/core/form/validation.py since they need a Session, not just the dict.
# ---------------------------------------------------------------------------

def _unique_option_fields(options: list) -> list:
    """option_id and value each need to be unique within a field's option
    list — option_id is the durable identity (edit-lifecycle archiving,
    write-through, branching match), value is the TD-facing stored/matched
    payload. A collision on either would make selection ambiguous. value is
    normally a string, but an entity-backed reserved field_key (e.g.
    availability grouping several TournamentShifts, event_preference
    grouping several TournamentEvents under one option) may set it to a
    list[int] instead — hashed as a tuple here since lists aren't hashable."""
    seen_ids, seen_values = set(), set()
    for option in options:
        if option.option_id in seen_ids:
            raise ValueError(f"duplicate option_id '{option.option_id}'")
        seen_ids.add(option.option_id)
        value_key = tuple(option.value) if isinstance(option.value, list) else option.value
        if value_key in seen_values:
            raise ValueError(f"duplicate option value '{option.value}'")
        seen_values.add(value_key)
    return options


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
    value: str | list[int] = Field(min_length=1)
    label: str = Field(min_length=1)
    is_archived: bool = False


class BranchingOption(BaseModel):
    """An option that may carry branching — single_select_radio/dropdown only.
    See PlainOption for value's dual str/list[int] shape."""
    model_config = ConfigDict(extra="forbid")
    option_id: str = Field(min_length=1)
    value: str | list[int] = Field(min_length=1)
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
    form. `field_key` is only meaningful (and required) on create — on an
    update it's server-controlled (immutable, or carried over onto a
    question_type-change replacement) and any value sent here is ignored."""
    id: str | None = None
    field_key: str | None = None
    label: str
    description: str | None = None
    question_type: str
    config: dict[str, Any] | None = None


class BulkFieldsUpdate(BaseModel):
    fields: list[BulkFieldEntry]


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
    chapter_id: int | None = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    response_count: int = 0
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
    creator: MembershipSlimResponse | ChapterMemberResponse | UserSlimResponse
    created_at: datetime
    updated_at: datetime
    response_count: int = 0

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
