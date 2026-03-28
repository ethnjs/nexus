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
# existing code referencing it directly continues to work.
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
# Valid column mapping types
# ---------------------------------------------------------------------------
VALID_MAPPING_TYPES: set[str] = {
    "string",        # store value as-is
    "ignore",        # skip this column entirely
    "boolean",       # "Yes"/"No" → True/False
    "integer",       # parse to int
    "multi_select",  # split on delimiter → JSON array; rules run before splitting
    "matrix_row",    # one row of a grid question → merged into availability JSON
                     # requires row_key; use parse_time_range rule to parse time slots
}

VALID_SHEET_TYPES = {"volunteers", "events"}

# ---------------------------------------------------------------------------
# Backwards compatibility
# ---------------------------------------------------------------------------
_LEGACY_TYPE_MAP: dict[str, str] = {
    "availability_row": "matrix_row",
    "category_events":  "string",
}

LEGACY_SHEET_TYPE_MAP: dict[str, str] = {
    "interest":     "volunteers",
    "confirmation": "volunteers",
}


def coerce_legacy_type(type_value: str) -> str:
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
# ParseRule
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
    "parse_time_range",    # canonical — parses time block on matrix_row cells
    "parse_availability",  # legacy alias — accepted on read, treated identically
}

# Actions that require a `value` field
_ACTIONS_REQUIRING_VALUE: set[str] = {"set", "replace", "prepend", "append"}

# Actions that perform time-range parsing (canonical + legacy alias)
PARSE_TIME_RANGE_ACTIONS: set[str] = {"parse_time_range", "parse_availability"}


class ParseRule(BaseModel):
    model_config = {"populate_by_name": True}

    condition: str
    match: str | None = None
    case_sensitive: bool = False
    action: str
    value: str | None = None

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


# ---------------------------------------------------------------------------
# ColumnMapping
# ---------------------------------------------------------------------------
class ColumnMapping(BaseModel):
    model_config = {"populate_by_name": True}

    field: str
    type: str
    row_key: str | None = None
    extra_key: str | None = None
    rules: list[ParseRule] | None = None
    delimiter: str | None = None

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
        if self.rules:
            for i, rule in enumerate(self.rules):
                if rule.action in PARSE_TIME_RANGE_ACTIONS and self.type != "matrix_row":
                    raise ValueError(
                        f"Rule {i}: {rule.action} is only valid on matrix_row fields"
                    )
        return self


# ---------------------------------------------------------------------------
# Google Forms integration
# ---------------------------------------------------------------------------
FORMS_TYPE_MAP: dict[str, str] = {
    "TEXT":            "string",
    "PARAGRAPH_TEXT":  "string",
    "MULTIPLE_CHOICE": "string",
    "CHECKBOX":        "multi_select",
    "DROP_DOWN":       "string",
    "LINEAR_SCALE":    "integer",
    "SCALE":           "integer",
    "GRID":            "matrix_row",
    "DATE":            "string",
    "TIME":            "string",
}


class FormQuestionOption(BaseModel):
    """A single answer choice from a Google Form choice question."""
    raw: str    # exact string as it appears in the form
    alias: str  # auto-suggested short version for DB storage


# ---------------------------------------------------------------------------
# MappedHeader — flat response item replacing the old headers+suggestions split.
#
# One entry per sheet column, with suggested mapping and form enrichment
# already cross-referenced by the service layer. The frontend maps these
# directly to RichMappingRow objects — no client-side cross-referencing needed.
# ---------------------------------------------------------------------------
class MappedHeader(BaseModel):
    """
    A single sheet column with its suggested mapping and optional form enrichment.
    """
    header:      str
    field:       str
    type:        str
    row_key:     str | None = None
    extra_key:   str | None = None
    rules:       list[ParseRule] | None = None
    delimiter:   str | None = None

    # Form question enrichment — None when no form URL provided or no question matched
    google_type:  str | None = None   # raw Google Forms type e.g. "CHECKBOX", "RADIO"
    options:      list[FormQuestionOption] | None = None
    grid_rows:    list[str] | None = None
    grid_columns: list[str] | None = None

    def model_dump(self, **kwargs):
        kwargs.setdefault("exclude_none", True)
        return super().model_dump(**kwargs)


# ---------------------------------------------------------------------------
# SheetConfig schemas
# ---------------------------------------------------------------------------
class SheetConfigBase(BaseModel):
    label: str
    sheet_type: str
    sheet_url: str
    sheet_name: str
    column_mappings: dict[str, ColumnMapping] = {}

    @field_validator("sheet_type")
    @classmethod
    def validate_sheet_type(cls, v: str) -> str:
        v = LEGACY_SHEET_TYPE_MAP.get(v, v)
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
    label:           str | None = None
    sheet_type:      str | None = None
    sheet_name:      str | None = None
    column_mappings: dict[str, ColumnMapping] | None = None
    is_active:       bool | None = None


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
    column_mappings: dict[str, ColumnMapping] = {}


class ValidateMappingsResponse(BaseModel):
    ok:       bool
    errors:   list[dict] = []
    warnings: list[dict] = []


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
    sheet_url:  str
    sheet_name: str
    sheet_type: Literal["volunteers", "events"]
    form_url:   str | None = None

    @field_validator("form_url")
    @classmethod
    def validate_form_url(cls, v: str | None) -> str | None:
        if v is not None and "docs.google.com/forms" not in v:
            raise ValueError("Must be a valid Google Forms URL")
        return v


class SheetHeadersResponse(BaseModel):
    """
    Flat list of mapped headers — one MappedHeader per sheet column.

    Replaces the previous headers (list) + suggestions (dict) + form_questions
    (list) triple. Each MappedHeader includes the suggested field mapping and
    any form question enrichment, already cross-referenced by the service layer.
    """
    sheet_name: str
    sheet_type: str
    mappings:   list[MappedHeader]
    known_fields:          list[str] = VOLUNTEER_KNOWN_FIELDS
    valid_types:           list[str] = list(VALID_MAPPING_TYPES)
    valid_rule_conditions: list[str] = list(VALID_RULE_CONDITIONS)
    valid_rule_actions:    list[str] = list(VALID_RULE_ACTIONS)


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