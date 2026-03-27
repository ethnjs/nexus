from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, field_validator, model_validator


# ---------------------------------------------------------------------------
# Known fields, scoped by sheet type.
# VOLUNTEER_KNOWN_FIELDS — fields that map to User + Membership tables.
# EVENT_KNOWN_FIELDS     — stub, populated when events import is implemented.
# ALL_KNOWN_FIELDS       — union used by ColumnMapping validator.
#
# KNOWN_FIELDS is kept as an alias for VOLUNTEER_KNOWN_FIELDS so that any
# existing code referencing it directly continues to work during the migration.
# ---------------------------------------------------------------------------
VOLUNTEER_KNOWN_FIELDS: list[str] = [
    "__ignore__",
    # User identity (→ User table)
    "first_name",
    "last_name",
    "email",
    "phone",
    "shirt_size",
    "dietary_restriction",
    "university",
    "major",
    "employer",
    # Membership fields (→ Membership table)
    "role_preference",
    "event_preference",
    "availability",
    "lunch_order",
    "notes",
    # Catch-all — stored in Membership.extra_data keyed by custom field key
    "extra_data",
]

# Stub — field list will be defined when events import is implemented
EVENT_KNOWN_FIELDS: list[str] = [
    "__ignore__",
    # Event fields (→ Event table) — TBD
    "extra_data",
]

# Union of all valid fields across all sheet types — used by ColumnMapping validator
ALL_KNOWN_FIELDS: set[str] = set(VOLUNTEER_KNOWN_FIELDS) | set(EVENT_KNOWN_FIELDS)

# Backwards-compat alias — existing code referencing KNOWN_FIELDS still works
KNOWN_FIELDS = VOLUNTEER_KNOWN_FIELDS

# Map of sheet type → its scoped field list, for SheetHeadersResponse
KNOWN_FIELDS_BY_TYPE: dict[str, list[str]] = {
    "volunteers": VOLUNTEER_KNOWN_FIELDS,
    "events":     EVENT_KNOWN_FIELDS,
}

# ---------------------------------------------------------------------------
# Valid column mapping types — tells the sync service how to process a column
# ---------------------------------------------------------------------------
VALID_MAPPING_TYPES: set[str] = {
    "string",        # store value as-is
    "ignore",        # skip this column entirely
    "boolean",       # "Yes"/"No" → True/False
    "integer",       # parse to int
    "multi_select",  # split on delimiter → JSON array
    "matrix_row",    # one row of a grid question; what happens to the value
                     # is determined by parse rules on the mapping
                     # requires row_key
}

VALID_SHEET_TYPES = {"volunteers", "events"}

# ---------------------------------------------------------------------------
# Backwards compatibility — map removed/renamed type names to current ones.
# Applied on read so stale saved configs continue to work.
# ---------------------------------------------------------------------------
_LEGACY_TYPE_MAP: dict[str, str] = {
    "availability_row": "matrix_row",   # renamed in feat/sheet-config-parse-rules
    "category_events":  "string",       # removed in feat/sheet-config-parse-rules
}

# Legacy sheet_type values → current equivalents.
# Used by the Alembic migration and any runtime coercion needed on old records.
LEGACY_SHEET_TYPE_MAP: dict[str, str] = {
    "interest":     "volunteers",
    "confirmation": "volunteers",
}


def coerce_legacy_type(type_value: str) -> str:
    """
    Coerce a legacy ColumnMapping type string to its current equivalent.
    Logs a warning for any type that needed coercion.
    Returns the coerced value, or the original if no coercion is needed.
    """
    if type_value in _LEGACY_TYPE_MAP:
        import logging
        new_type = _LEGACY_TYPE_MAP[type_value]
        logging.getLogger(__name__).warning(
            "Legacy ColumnMapping type '%s' coerced to '%s'. "
            "Resave this sheet config to clear this warning.",
            type_value, new_type,
        )
        return new_type
    return type_value


# ---------------------------------------------------------------------------
# ParseRule — a single transformation rule applied to a raw cell value.
#
# Rules run in order on the raw string before type coercion. Each rule sees
# the output of the previous rule. All matching rules fire (not first-match).
#
# Conditions:
#   always      — fires unconditionally; match is not required
#   contains    — substring match (case-insensitive by default)
#   equals      — exact match
#   starts_with — prefix match
#   ends_with   — suffix match
#   regex       — full Python regex match against the whole string
#
# Actions:
#   set              — replace entire value with `value`
#   replace          — replace matched portion with `value`
#                      (for regex condition, uses re.sub; otherwise str.replace)
#   prepend          — prepend `value` to the current string
#   append           — append `value` to the current string
#   discard          — treat cell as empty/null (value not required)
#   parse_availability — run availability parsing on this matrix_row cell
#                        (only valid on matrix_row fields; condition must be always)
# ---------------------------------------------------------------------------
VALID_RULE_CONDITIONS: set[str] = {
    "always",
    "contains",
    "equals",
    "starts_with",
    "ends_with",
    "regex",
}

VALID_RULE_ACTIONS: set[str] = {
    "set",
    "replace",
    "prepend",
    "append",
    "discard",
    "parse_availability",
}

# Actions that require a `value` field
_ACTIONS_REQUIRING_VALUE: set[str] = {"set", "replace", "prepend", "append"}


class ParseRule(BaseModel):
    model_config = {"populate_by_name": True}
 
    condition: str               # one of VALID_RULE_CONDITIONS
    match: str | None = None     # required for all conditions except "always"
    case_sensitive: bool = False
    action: str                  # one of VALID_RULE_ACTIONS
    value: str | None = None     # required for set, replace, prepend, append
 
    def model_dump(self, **kwargs):
        kwargs.setdefault("exclude_none", True)
        return super().model_dump(**kwargs)
 
    @field_validator("condition")
    @classmethod
    def validate_condition(cls, v: str) -> str:
        if v not in VALID_RULE_CONDITIONS:
            raise ValueError(f"condition must be one of: {VALID_RULE_CONDITIONS}")
        return v
 
    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        if v not in VALID_RULE_ACTIONS:
            raise ValueError(f"action must be one of: {VALID_RULE_ACTIONS}")
        return v
 
    # model_validator REMOVED — all business logic validation (match required,
    # value required, regex compiles, parse_availability condition) is handled
    # by validate_column_mappings() in sheets_validation.py so that errors are
    # returned in our structured { errors, warnings } format rather than as raw
    # Pydantic validation errors.


# ---------------------------------------------------------------------------
# ColumnMapping — the rich mapping entry for a single column header
# ---------------------------------------------------------------------------
class ColumnMapping(BaseModel):
    model_config = {"populate_by_name": True}

    field: str                          # target DB field name from KNOWN_FIELDS
    type: str                           # one of VALID_MAPPING_TYPES
    row_key: str | None = None          # required for matrix_row — e.g. "8:00 AM - 10:00 AM"
    extra_key: str | None = None        # required when field is "extra_data"
    rules: list[ParseRule] | None = None  # ordered transform rules, applied before type coercion
    delimiter: str | None = None        # for multi_select only; defaults to "," if absent

    def model_dump(self, **kwargs):
        kwargs.setdefault("exclude_none", True)
        return super().model_dump(**kwargs)

    @field_validator("type", mode="before")
    @classmethod
    def coerce_type(cls, v: str) -> str:
        return coerce_legacy_type(v)

    @field_validator("field")
    @classmethod
    def validate_field(cls, v: str) -> str:
        if v not in ALL_KNOWN_FIELDS:
            raise ValueError(f"Unknown field '{v}'. Must be one of: {ALL_KNOWN_FIELDS}")
        return v

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in VALID_MAPPING_TYPES:
            raise ValueError(f"type must be one of: {VALID_MAPPING_TYPES}")
        return v

    @model_validator(mode="after")
    def validate_mapping(self) -> ColumnMapping:
        if self.type == "matrix_row" and not self.row_key:
            raise ValueError("row_key is required for matrix_row type")
        if self.type == "ignore" and self.field != "__ignore__":
            raise ValueError("field must be '__ignore__' when type is 'ignore'")
        if self.field == "extra_data" and not self.extra_key:
            raise ValueError("extra_key is required when field is 'extra_data'")
        if self.delimiter is not None and self.type != "multi_select":
            raise ValueError("delimiter is only valid for multi_select type")

        # parse_availability rules are only valid on matrix_row fields
        if self.rules:
            for i, rule in enumerate(self.rules):
                if rule.action == "parse_availability" and self.type != "matrix_row":
                    raise ValueError(
                        f"Rule {i}: parse_availability is only valid on matrix_row fields"
                    )

        return self


# ---------------------------------------------------------------------------
# FormQuestion — a single question fetched from a linked Google Form.
# Returned in SheetHeadersResponse to power the option alias editor in the
# mapping wizard. The frontend uses this to render form-native UI instead of
# the raw rules accordion for choice questions.
# ---------------------------------------------------------------------------

# Maps Google Forms API question types to NEXUS ColumnMapping types.
# Used by FormsService when building FormQuestion objects.
FORMS_TYPE_MAP: dict[str, str] = {
    "TEXT":           "string",       # short text
    "PARAGRAPH_TEXT": "string",       # long text
    "MULTIPLE_CHOICE": "string",      # radio — pick one
    "CHECKBOX":       "multi_select", # pick many
    "DROP_DOWN":      "string",       # dropdown — pick one
    "LINEAR_SCALE":   "integer",      # numeric rating
    "SCALE":          "integer",      # numeric scale
    "GRID":           "matrix_row",   # checkbox/radio grid → multiple matrix_row mappings
    "DATE":           "string",
    "TIME":           "string",
}


class FormQuestionOption(BaseModel):
    """A single answer choice from a Google Form choice question."""
    raw: str                    # exact string as it appears in the form
    alias: str                  # auto-suggested short version for DB storage


class FormQuestion(BaseModel):
    """
    Structured representation of a single Google Form question.
    question_id matches the Forms API questionId, used to cross-reference
    with sheet column headers during mapping suggestion.
    """
    question_id: str
    title: str                              # question title as shown to respondents
    nexus_type: str                         # mapped NEXUS ColumnMapping type
    options: list[FormQuestionOption] | None = None   # for CHECKBOX / MULTIPLE_CHOICE / DROP_DOWN
    grid_rows: list[str] | None = None      # for GRID questions — row labels (time ranges etc.)
    grid_columns: list[str] | None = None   # for GRID questions — column labels


# ---------------------------------------------------------------------------
# SheetConfig schemas
# ---------------------------------------------------------------------------
class SheetConfigBase(BaseModel):
    label: str
    sheet_type: str
    sheet_url: str
    sheet_name: str
    # Rich mappings: header → ColumnMapping
    column_mappings: dict[str, ColumnMapping] = {}

    @field_validator("sheet_type")
    @classmethod
    def validate_sheet_type(cls, v: str) -> str:
        if v not in VALID_SHEET_TYPES:
            raise ValueError(f"sheet_type must be one of: {VALID_SHEET_TYPES}")
        return v

    @field_validator("sheet_url")
    @classmethod
    def validate_sheet_url(cls, v: str) -> str:
        if "docs.google.com/spreadsheets" not in v:
            raise ValueError("Must be a Google Sheets URL")
        return v


class SheetConfigCreate(SheetConfigBase):
    tournament_id: int


class SheetConfigUpdate(BaseModel):
    """Partial update — all fields optional."""
    label: str | None = None
    sheet_name: str | None = None
    column_mappings: dict[str, ColumnMapping] | None = None
    is_active: bool | None = None


class SheetConfigRead(SheetConfigBase):
    id: int
    tournament_id: int
    spreadsheet_id: str
    is_active: bool
    last_synced_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class SheetConfigReadWithWarnings(SheetConfigRead):
    """SheetConfigRead extended with validation warnings from a successful save."""
    warnings: list[dict] = []

class ValidateMappingsRequest(BaseModel):
    """Request body for POST /configs/validate-mappings/ — column mappings to validate."""
    column_mappings: dict[str, ColumnMapping] = {}
 
 
class ValidateMappingsResponse(BaseModel):
    """Response from POST /configs/validate-mappings/ — validation result without DB write."""
    ok:       bool
    errors:   list[dict] = []   # list of {header, rule_index, message}
    warnings: list[dict] = []   # list of {header, rule_index, message}

# ---------------------------------------------------------------------------
# Wizard step request/response shapes
# ---------------------------------------------------------------------------
class SheetValidateRequest(BaseModel):
    sheet_url: str

    @field_validator("sheet_url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        if "docs.google.com/spreadsheets" not in v:
            raise ValueError("Must be a valid Google Sheets URL")
        return v


class SheetValidateResponse(BaseModel):
    spreadsheet_id: str
    spreadsheet_title: str
    sheet_names: list[str]


class SheetHeadersRequest(BaseModel):
    sheet_url: str
    sheet_name: str
    sheet_type: Literal["volunteers", "events"]
    form_url: str | None = None     # required for volunteers; ignored for events

    @field_validator("form_url")
    @classmethod
    def validate_form_url(cls, v: str | None) -> str | None:
        if v is not None and "docs.google.com/forms" not in v:
            raise ValueError("Must be a valid Google Forms URL")
        return v


class SheetHeadersResponse(BaseModel):
    """
    Returns column headers and auto-detected rich mapping suggestions.
    suggestions maps each header to a ColumnMapping dict.
    known_fields lists valid field names for the UI dropdown, scoped to sheet_type.
    valid_types lists all valid type strings for the UI dropdown.
    valid_rule_conditions and valid_rule_actions list valid values for rule editors.
    form_questions carries structured question data from the linked Google Form
    (volunteers only) to power the option alias editor in the mapping wizard.
    """
    sheet_name: str
    sheet_type: str
    headers: list[str]
    suggestions: dict[str, ColumnMapping]
    known_fields: list[str] = VOLUNTEER_KNOWN_FIELDS
    valid_types: list[str] = list(VALID_MAPPING_TYPES)
    valid_rule_conditions: list[str] = list(VALID_RULE_CONDITIONS)
    valid_rule_actions: list[str] = list(VALID_RULE_ACTIONS)
    form_questions: list[FormQuestion] | None = None   # None for events sheets


# ---------------------------------------------------------------------------
# Sync response
# ---------------------------------------------------------------------------
class SyncError(BaseModel):
    row: int
    email: str | None
    detail: str


class SyncResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[SyncError]
    last_synced_at: datetime