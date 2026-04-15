from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, model_validator, field_validator
from app.core.permissions import ALL_PERMISSIONS
from app.schemas.time_block import TimeBlockRead
from app.schemas.tournament_category import TournamentCategoryRead


# ---------------------------------------------------------------------------
# Custom field schema — one entry in volunteer_schema.custom_fields
# ---------------------------------------------------------------------------
VALID_CUSTOM_FIELD_TYPES = {"string", "boolean", "integer", "multi_select", "matrix"}


class CustomField(BaseModel):
    key: str        # snake_case identifier used in extra_data
    label: str      # human-readable label shown in the UI
    type: str       # one of VALID_CUSTOM_FIELD_TYPES

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in VALID_CUSTOM_FIELD_TYPES:
            raise ValueError(f"type must be one of: {VALID_CUSTOM_FIELD_TYPES}")
        return v

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        if not v.replace("_", "").isalnum():
            raise ValueError("key must be snake_case alphanumeric")
        return v


# ---------------------------------------------------------------------------
# Position definition schema — one entry in volunteer_schema.positions
#
# Positions define both the human-readable title shown in the UI and the
# system permissions granted to anyone assigned that position in a tournament.
#
# The default list is auto-populated from DEFAULT_POSITIONS in permissions.py
# when a tournament is created. TDs can add, edit, or remove positions at any
# time via PATCH /tournaments/{id}.
# ---------------------------------------------------------------------------
class PositionDefinition(BaseModel):
    key: str                    # snake_case identifier, matches Membership.positions entries
    label: str                  # human-readable name shown in the UI
    permissions: list[str] = [] # subset of ALL_PERMISSIONS from permissions.py

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        if not v.replace("_", "").isalnum():
            raise ValueError("key must be snake_case alphanumeric")
        return v

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: list[str]) -> list[str]:
        invalid = [p for p in v if p not in ALL_PERMISSIONS]
        if invalid:
            raise ValueError(
                f"Invalid permissions: {invalid}. Must be one of: {ALL_PERMISSIONS}"
            )
        return v


# ---------------------------------------------------------------------------
# VolunteerSchema — top-level structure stored in Tournament.volunteer_schema
# ---------------------------------------------------------------------------
class VolunteerSchema(BaseModel):
    custom_fields: list[CustomField] = []
    # Positions are intentionally not required on input — the backend
    # auto-populates them from DEFAULT_POSITIONS on tournament create.
    # TDs can then customise at any time.
    positions: list[PositionDefinition] = []


# ---------------------------------------------------------------------------
# Tournament schemas
# ---------------------------------------------------------------------------
class TournamentBase(BaseModel):
    name: str
    start_date: datetime | None = None
    end_date: datetime | None = None
    location: str | None = None
    volunteer_schema: VolunteerSchema = VolunteerSchema()

    @model_validator(mode="after")
    def validate_dates(self) -> TournamentBase:
        if self.start_date and self.end_date:
            if self.end_date < self.start_date:
                raise ValueError("end_date must be after start_date")
        return self


class TournamentCreate(TournamentBase):
    pass


class TournamentUpdate(BaseModel):
    """Partial update — all fields optional."""
    name: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    location: str | None = None
    volunteer_schema: VolunteerSchema | None = None


class TournamentRead(TournamentBase):
    id: int
    owner_id: int
    time_blocks: list[TimeBlockRead]
    categories: list[TournamentCategoryRead]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
