from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, field_validator, model_validator


# ---------------------------------------------------------------------------
# Core fields that map directly to User or Membership columns.
# These are the only fields the sync service handles explicitly.
# Everything else goes into extra_data via the custom field system.
# ---------------------------------------------------------------------------
KNOWN_FIELDS: list[str] = [
    "__ignore__",
    # User identity (→ User table)
    "first_name",
    "last_name",
    "email",
    "phone",
    "shirt_size",
    "dietary_restriction",
    # Membership fields (→ Membership table)
    "role_preference",
    "event_preference",
    "general_volunteer_interest",
    "availability",
    "lunch_order",
    "notes",
    # Catch-all — stored in Membership.extra_data keyed by custom field key
    "extra_data",
]

# ---------------------------------------------------------------------------
# Valid column mapping types — tells the sync service how to process a column
# ---------------------------------------------------------------------------
VALID_MAPPING_TYPES: set[str] = {
    "string",           # store value as-is
    "ignore",           # skip this column entirely
    "boolean",          # "Yes"/"No" → True/False
    "integer",          # parse to int
    "multi_select",     # comma-separated → JSON array
    "matrix_row",       # one row of a grid question → merged into availability JSON
                        # requires row_key
    "category_events",  # grouped event category string → list of specific event names
}

VALID_SHEET_TYPES = {"interest", "confirmation", "events"}


# ---------------------------------------------------------------------------
# ColumnMapping — the rich mapping entry for a single column header
# ---------------------------------------------------------------------------
class ColumnMapping(BaseModel):
    model_config = {"populate_by_name": True}

    field: str          # target DB field name from KNOWN_FIELDS
    type: str           # one of VALID_MAPPING_TYPES
    row_key: str | None = None  # required for matrix_row — time label e.g. "8:00 AM - 10:00 AM"
    extra_key: str | None = None  # for extra_data fields — key in the JSON blob

    def model_dump(self, **kwargs):
        kwargs.setdefault("exclude_none", True)
        return super().model_dump(**kwargs)

    @field_validator("field")
    @classmethod
    def validate_field(cls, v: str) -> str:
        if v not in KNOWN_FIELDS:
            raise ValueError(f"Unknown field '{v}'. Must be one of: {KNOWN_FIELDS}")
        return v

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in VALID_MAPPING_TYPES:
            raise ValueError(f"type must be one of: {VALID_MAPPING_TYPES}")
        return v

    @model_validator(mode="after")
    def validate_matrix_row_key(self) -> ColumnMapping:
        if self.type == "matrix_row" and not self.row_key:
            raise ValueError("row_key is required for matrix_row type")
        if self.type == "ignore" and self.field != "__ignore__":
            raise ValueError("field must be '__ignore__' when type is 'ignore'")
        if self.field == "extra_data" and not self.extra_key:
            raise ValueError("extra_key is required when field is 'extra_data'")
        return self


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
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


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


class SheetHeadersResponse(BaseModel):
    """
    Returns column headers and auto-detected rich mapping suggestions.
    suggestions maps each header to a ColumnMapping dict.
    known_fields lists all valid field names for the UI dropdown.
    """
    sheet_name: str
    headers: list[str]
    suggestions: dict[str, ColumnMapping]
    known_fields: list[str] = KNOWN_FIELDS
    valid_types: list[str] = list(VALID_MAPPING_TYPES)