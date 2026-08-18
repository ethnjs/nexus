from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# FormField.config schemas — one per question_type, shape enforced per
# form-question-types-reference.md. These cover structural shape only
# (required keys, types, per-option uniqueness, ranks <= options); DB-backed
# checks (next_field_id resolving to a real field, availability options
# resolving to a real TournamentShift, reserved field_key pairing) stay in
# app/core/form/validation.py since they need a Session, not just the dict.
# ---------------------------------------------------------------------------

def _unique_option_values(options: list) -> list:
    seen = set()
    for option in options:
        if option.value in seen:
            raise ValueError(f"duplicate option value '{option.value}'")
        seen.add(option.value)
    return options


class PlainOption(BaseModel):
    """An option with no branching — multi_select_checkbox, ranked_choice.
    extra='forbid' rejects a stray next_field_id/action on these types."""
    model_config = ConfigDict(extra="forbid")
    value: str = Field(min_length=1)
    label: str = Field(min_length=1)


class BranchingOption(BaseModel):
    """An option that may carry branching — single_select_radio/dropdown only."""
    model_config = ConfigDict(extra="forbid")
    value: str = Field(min_length=1)
    label: str = Field(min_length=1)
    next_field_id: int | None = None
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


class SingleSelectConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    required: bool
    options: list[BranchingOption]

    @field_validator("options")
    @classmethod
    def _unique_values(cls, options: list[BranchingOption]) -> list[BranchingOption]:
        return _unique_option_values(options)


class MultiSelectCheckboxConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    required: bool
    options: list[PlainOption]

    @field_validator("options")
    @classmethod
    def _unique_values(cls, options: list[PlainOption]) -> list[PlainOption]:
        return _unique_option_values(options)


class RankedChoiceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    required: bool
    ranks: int = Field(gt=0)
    allow_duplicates: bool
    options: list[PlainOption]

    @field_validator("options")
    @classmethod
    def _unique_values(cls, options: list[PlainOption]) -> list[PlainOption]:
        return _unique_option_values(options)

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
    "single_select_radio": SingleSelectConfig,
    "single_select_dropdown": SingleSelectConfig,
    "multi_select_checkbox": MultiSelectCheckboxConfig,
    "ranked_choice": RankedChoiceConfig,
    "short_text": TextConfig,
    "long_text": TextConfig,
}


# ---------------------------------------------------------------------------
# Form Field Schemas
# ---------------------------------------------------------------------------

class FormFieldRead(BaseModel):
    id: int
    form_id: int
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


class FormFieldCreate(BaseModel):
    # field_key is TD-typed, separate from `label` — the TD's own name for
    # the dashboard lookup key. Server-side slugify() normalizes it (see
    # app/core/form.slugify)
    label: str
    field_key: str
    question_type: str
    description: str | None = None
    order: int | None = None
    config: dict[str, Any] | None = None


class FormFieldUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    question_type: str | None = None
    order: int | None = None
    config: dict | None = None

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Form Schemas
# ---------------------------------------------------------------------------

class FormTournamentMembershipConfigIn(BaseModel):
    status_on_submit: Literal["interested", "confirmed"] | None = None
    role_ids_on_submit: list[int] = []


class FormTournamentMembershipConfigRead(BaseModel):
    status_on_submit: Literal["interested", "confirmed"] | None = None
    role_ids_on_submit: list[int] = []

    model_config = ConfigDict(from_attributes=True)


class FormChapterMembershipConfigIn(BaseModel):
    role_on_submit: Literal["lead", "officer", "member"] = "member"


class FormChapterMembershipConfigRead(BaseModel):
    role_on_submit: Literal["lead", "officer", "member"] = "member"

    model_config = ConfigDict(from_attributes=True)


class FormRead(BaseModel):
    id: int
    name: str
    description: str | None = None
    status: Literal["draft", "published", "archived"]
    owner_type: Literal["tournament", "chapter"]
    tournament_id: int | None = None
    chapter_id: int | None = None
    creates_membership_on_submit: bool = False
    tournament_membership_config: FormTournamentMembershipConfigRead | None = None
    chapter_membership_config: FormChapterMembershipConfigRead | None = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    fields: list[FormFieldRead] = []

    model_config = ConfigDict(from_attributes=True)


class FormCreate(BaseModel):
    name: str
    description: str | None = None
    owner_type: Literal["tournament", "chapter"]
    tournament_id: int | None = None
    chapter_id: int | None = None
    creates_membership_on_submit: bool = False
    tournament_membership_config: FormTournamentMembershipConfigIn | None = None
    chapter_membership_config: FormChapterMembershipConfigIn | None = None

    @model_validator(mode="after")
    def _require_matching_owner(self):
        if self.owner_type == "tournament":
            if self.tournament_id is None or self.chapter_id is not None:
                raise ValueError("owner_type 'tournament' requires tournament_id and no chapter_id")
            if self.chapter_membership_config is not None:
                raise ValueError("chapter_membership_config only applies to owner_type 'chapter'")
        else:
            if self.chapter_id is None or self.tournament_id is not None:
                raise ValueError("owner_type 'chapter' requires chapter_id and no tournament_id")
            if self.tournament_membership_config is not None:
                raise ValueError("tournament_membership_config only applies to owner_type 'tournament'")
        return self


class FormUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: Literal["draft", "published", "archived"] | None = None
    creates_membership_on_submit: bool | None = None
    tournament_membership_config: FormTournamentMembershipConfigIn | None = None
    chapter_membership_config: FormChapterMembershipConfigIn | None = None


# ---------------------------------------------------------------------------
# Form Response / Answer Schemas
# ---------------------------------------------------------------------------

class FormAnswerCreate(BaseModel):
    field_id: int
    value: Any


class FormAnswerRead(BaseModel):
    id: int
    field_id: int
    value: Any

    model_config = ConfigDict(from_attributes=True)


class FormResponseCreate(BaseModel):
    answers: list[FormAnswerCreate]


class FormResponseRead(BaseModel):
    id: int
    form_id: int
    user_id: int
    submitted_at: datetime
    updated_at: datetime
    answers: list[FormAnswerRead] = []

    model_config = ConfigDict(from_attributes=True)
