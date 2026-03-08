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
    # Volunteer profile
    "shirt_size",
    "dietary_restriction",
    "university",               # current employer or university
    "age_verified",             # yes/no age confirmation
    "conflict_of_interest",     # string, null if n/a
    # Science Olympiad background (store as text blobs)
    "scioly_competed",          # have you competed before? yes/no
    "scioly_competed_events",   # which events/schools if competed
    "scioly_volunteered",       # have you volunteered before? yes/no
    "scioly_experience",        # free-text description of past experience + expertise
    "event_expertise",          # multi-value: comma-separated event names
    # Role & availability
    "role_preference",          # multi-value: "event_volunteer,general_volunteer"
    "event_preference",         # which event(s) they want to work (raw form string)
    "general_volunteer_interest", # multi-value: stem expo, opening ceremony, etc.
    "availability",             # time block availability (multi-value per time slot)
    # Logistics
    "transportation",           # how they're getting there (drives/uber/carpool etc.)
    "is_driver",                # boolean derived from transportation answer
    "carpool_seats",            # how many people they can take if driving
    "limitations",              # physical/accessibility limitations
    "lunch_order",
    # Meta
    "notes",                    # catch-all for misc fields
]

VALID_SHEET_TYPES = {"interest", "confirmation", "events"}


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