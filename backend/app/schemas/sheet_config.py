from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, field_validator, model_validator


# ---------------------------------------------------------------------------
# Known fields, scoped by sheet type.
# VOLUNTEER_KNOWN_FIELDS — fields that map to User + Membership tables.
# EVENT_KNOWN_FIELDS     — stub, populated when events import is implemented.
# ALL_KNOWN_FIELDS       — union used by ColumnMapping validator.
#
# KNOWN_FIELDS is kept as an alias for VOLUNTEER_KNOWN_FIELDS so that any
# existing code referencing it directly continues to work.
#
# full_name is a mapping-only field — sync splits it into first_name + last_name
# before writing to the User table. It never becomes a DB column.
# ---------------------------------------------------------------------------
VOLUNTEER_KNOWN_FIELDS: list[str] = [
    "__ignore__",
    # User identity (→ User table)
    "full_name",
    "first_name",
    "last_name",
    "email",
    "phone",
    # TODO(temp): volunteer profile fields (-> Membership table until user self management)
    "shirt_size",
    "dietary_restriction",
    "university",
    "major",
    "employer",
    "student_status",
    "competition_exp",
    "volunteering_exp",
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
# Field type — the shape/structure of the output value.
# Value type — the coercion applied to each individual value.
# ---------------------------------------------------------------------------
VALID_FIELD_TYPES: set[str] = {
    "single",   # One value → scalar
    "list",     # Multiple values → array
    "group",    # Keyed values → dict (requires group_key)
    "ignore",   # No output
}

VALID_VALUE_TYPES: set[str] = {
    "text",        # String, no coercion
    "number",      # Int or float
    "boolean",     # "Yes"/"No", "True"/"False" → bool
    "date",        # Date or datetime string → parsed date
    "time_range",  # "8:00 AM - 10:00 AM" style → slot object
}

VALID_SHEET_TYPES = {"volunteers", "events"}

# ---------------------------------------------------------------------------
# Legacy type → (field_type, value_type) coercion map.
# Applied on read before validation so old saved configs still load.
# ---------------------------------------------------------------------------
_LEGACY_FIELD_VALUE_MAP: dict[str, tuple[str, str | None]] = {
    "string":       ("single", "text"),
    "boolean":      ("single", "boolean"),
    "integer":      ("single", "number"),
    "multi_select": ("list",   "text"),
    "matrix_row":   ("group",  "text"),
    "ignore":       ("ignore", None),
}

# ---------------------------------------------------------------------------
# Backwards compatibility — legacy mapping type aliases
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
    """Coerce old type aliases (availability_row, category_events) to their canonical old types."""
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


def coerce_legacy_mapping(data: dict) -> dict:
    """
    Translate old type/row_key fields to field_type/value_type/group_key on read.

    This runs on ColumnMapping model_validator(mode='before') so old DB data
    loaded before the migration still parses correctly. After the migration,
    all stored data already uses field_type/value_type/group_key.
    """
    data = dict(data)

    # Translate old flat `type` field → field_type + value_type
    if "type" in data and "field_type" not in data:
        old_type = coerce_legacy_type(str(data.pop("type")))
        field_type, value_type = _LEGACY_FIELD_VALUE_MAP.get(old_type, ("single", "text"))
        data["field_type"] = field_type
        if value_type is not None:
            data.setdefault("value_type", value_type)

    # Rename row_key → group_key
    if "row_key" in data and "group_key" not in data:
        data["group_key"] = data.pop("row_key")

    return data


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
}

# Actions that require a `value` field
_ACTIONS_REQUIRING_VALUE: set[str] = {"set", "replace", "prepend", "append"}


class ParseRule(BaseModel):
    model_config = {"populate_by_name": True}

    condition: str
    match: str | None = None
    case_sensitive: bool = False
    action: str
    value: str | None = None
    is_alias: bool = False  # True = generated from a form option alias

    def model_dump(self, **kwargs):
        kwargs.setdefault("exclude_none", True)
        result = super().model_dump(**kwargs)
        if not result.get("is_alias", False):
            result.pop("is_alias", None)
        return result

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
# ColumnMapping
#
# options, grid_rows, and grid_columns are persisted alongside rules/delimiter
# so the alias editor works on the edit page and in JSON exports without
# re-fetching form data. No migration needed — column_mappings is a JSON column.
# ---------------------------------------------------------------------------
class ColumnMapping(BaseModel):
    model_config = {"populate_by_name": True}

    field: str
    field_type: str
    value_type: str | None = None
    group_key: str | None = None
    extra_key: str | None = None
    rules: list[ParseRule] | None = None
    delimiter: str | None = None

    # Form question enrichment — persisted so edit page + exports retain alias editor context
    # options is a flat list of raw option strings; aliases are encoded in rules (is_alias=True)
    options:      list[str] | None = None
    grid_rows:    list[str] | None = None
    grid_columns: list[str] | None = None

    def model_dump(self, **kwargs):
        kwargs.setdefault("exclude_none", True)
        return super().model_dump(**kwargs)

    @model_validator(mode="before")
    @classmethod
    def coerce_legacy_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return coerce_legacy_mapping(data)
        return data

    @field_validator("field")
    @classmethod
    def validate_field(cls, v: str) -> str:
        if v not in ALL_KNOWN_FIELDS:
            raise ValueError(f"Unknown field '{v}'. Must be one of: {ALL_KNOWN_FIELDS}")
        return v

    @field_validator("field_type")
    @classmethod
    def validate_field_type(cls, v: str) -> str:
        if v not in VALID_FIELD_TYPES:
            raise ValueError(f"field_type must be one of: {VALID_FIELD_TYPES}")
        return v

    @field_validator("value_type")
    @classmethod
    def validate_value_type(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_VALUE_TYPES:
            raise ValueError(f"value_type must be one of: {VALID_VALUE_TYPES}")
        return v

    @model_validator(mode="after")
    def validate_field_value_combo(self) -> "ColumnMapping":
        if self.field_type == "ignore":
            if self.value_type is not None:
                raise ValueError("value_type must be null when field_type is 'ignore'")
        else:
            if self.value_type is None:
                raise ValueError(
                    f"value_type is required when field_type is '{self.field_type}'"
                )
        if self.field_type == "group" and not self.group_key:
            raise ValueError("group_key is required when field_type is 'group'")
        return self


class ColumnMappingEntry(ColumnMapping):
    """
    A single mapped sheet column with stable identity by index.

    This is the canonical shape for persisted/read mapping data:
      {column_index, header, field, field_type, value_type, ...}
    """
    column_index: int
    header: str

    @field_validator("column_index")
    @classmethod
    def validate_column_index(cls, v: int) -> int:
        if v < 0:
            raise ValueError("column_index must be >= 0")
        return v


def normalize_column_mappings_input(
    value: Any,
) -> list[dict[str, Any]]:
    """
    Accept both legacy dict and new list-of-entries mapping payloads.

    Legacy dict shape:
      {"Header": {field, type, ...}, ...}

    Canonical list shape:
      [{"column_index": 0, "header": "Header", field, field_type, ...}, ...]
    """
    if value is None:
        return []

    # Legacy shape: dict[header] -> mapping
    if isinstance(value, dict):
        out: list[dict[str, Any]] = []
        for idx, (header, mapping) in enumerate(value.items()):
            md = mapping.model_dump(exclude_none=True) if hasattr(mapping, "model_dump") else dict(mapping)
            out.append({
                "column_index": idx,
                "header": header,
                **md,
            })
        return out

    # Canonical shape: list[ColumnMappingEntry-like]
    if isinstance(value, list):
        out: list[dict[str, Any]] = []
        for idx, entry in enumerate(value):
            ed = entry.model_dump(exclude_none=True) if hasattr(entry, "model_dump") else dict(entry)
            out.append({
                "column_index": ed.get("column_index", idx),
                "header": ed.get("header", ""),
                **{k: v for k, v in ed.items() if k not in ("column_index", "header")},
            })
        return out

    raise ValueError("column_mappings must be a dict or list")

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
    column_index: int = 0
    header:      str
    field:       str
    field_type:  str
    value_type:  str | None = None
    group_key:   str | None = None
    extra_key:   str | None = None
    rules:       list[ParseRule] | None = None
    delimiter:   str | None = None

    # Form question enrichment — None when no form URL provided or no question matched
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
    column_mappings: list[ColumnMappingEntry] = []

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

    @field_validator("column_mappings", mode="before")
    @classmethod
    def normalize_column_mappings(cls, v: Any) -> list[dict[str, Any]]:
        return normalize_column_mappings_input(v)


class SheetConfigCreate(SheetConfigBase):
    tournament_id: int


class SheetConfigUpdate(BaseModel):
    """Partial update — all fields optional."""
    label:           str | None = None
    sheet_type:      str | None = None
    sheet_name:      str | None = None
    column_mappings: list[ColumnMappingEntry] | None = None
    is_active:       bool | None = None

    @field_validator("column_mappings", mode="before")
    @classmethod
    def normalize_column_mappings(cls, v: Any) -> list[dict[str, Any]] | None:
        if v is None:
            return None
        return normalize_column_mappings_input(v)


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
    """
    Accepts raw mapping dicts without running ColumnMappingEntry validators.

    Validation is intentionally deferred to validate_column_mappings() so that
    all errors are returned as structured ValidationIssue objects rather than
    raw Pydantic 422 responses that the frontend cannot parse.
    """
    column_mappings: list[dict[str, Any]] = []

    @field_validator("column_mappings", mode="before")
    @classmethod
    def normalize_column_mappings(cls, v: Any) -> list[dict[str, Any]]:
        return normalize_column_mappings_input(v)


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
    known_fields:           list[str] = VOLUNTEER_KNOWN_FIELDS
    valid_field_types:      list[str] = list(VALID_FIELD_TYPES)
    valid_value_types:      list[str] = list(VALID_VALUE_TYPES)
    valid_rule_conditions:  list[str] = list(VALID_RULE_CONDITIONS)
    valid_rule_actions:     list[str] = list(VALID_RULE_ACTIONS)


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
