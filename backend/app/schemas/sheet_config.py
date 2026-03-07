from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, field_validator
import re


# ---------------------------------------------------------------------------
# Known DB field names the mapper UI will offer as options.
# "__ignore__" is a special sentinel meaning "skip this column on import."
# Add new fields here as the app grows — the frontend reads this list.
# ---------------------------------------------------------------------------
KNOWN_FIELDS: list[str] = [
    "__ignore__",
    # User identity
    "first_name",
    "last_name",
    "email",
    "phone",
    # Volunteer preferences
    "shirt_size",
    "dietary_restriction",
    "event_expertise",   # multi-value: comma-separated event names from form
    # Membership / per-tournament
    "availability",      # all_day | am | pm
    "lunch_order",
    "event_preference",  # which event they'd like to work
    # Meta
    "notes",
]

VALID_SHEET_TYPES = {"interest", "confirmation"}


class SheetConfigBase(BaseModel):
    label: str
    sheet_type: str
    sheet_url: str
    sheet_name: str
    column_mappings: dict[str, str] = {}

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

    @field_validator("column_mappings")
    @classmethod
    def validate_column_mappings(cls, v: dict[str, str]) -> dict[str, str]:
        invalid = [val for val in v.values() if val not in KNOWN_FIELDS]
        if invalid:
            raise ValueError(f"Unknown field values in mapping: {invalid}")
        return v


class SheetConfigCreate(SheetConfigBase):
    tournament_id: int


class SheetConfigUpdate(BaseModel):
    """Partial update — all fields optional."""
    label: str | None = None
    sheet_name: str | None = None
    column_mappings: dict[str, str] | None = None
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
# Intermediate response shapes used during the wizard flow
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
    """Returned after validating a sheet URL — lists available tabs."""
    spreadsheet_id: str
    spreadsheet_title: str
    sheet_names: list[str]


class SheetHeadersRequest(BaseModel):
    sheet_url: str
    sheet_name: str


class SheetHeadersResponse(BaseModel):
    """Returns column headers and auto-detected field suggestions."""
    sheet_name: str
    headers: list[str]
    # Auto-detected mapping suggestions: header → suggested field (may be "__ignore__")
    suggestions: dict[str, str]
    known_fields: list[str] = KNOWN_FIELDS