from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, field_validator
from app.core.tournament.permissions import ALL_PERMISSIONS


# ---------------------------------------------------------------------------
# Role definition schema — create/update schema for TournamentRole rows.
#
# Deliberately a separate class from PositionDefinition (app.schemas.tournament)
# rather than a rename of it in place: PositionDefinition still backs the old,
# coexisting VolunteerSchema.positions field (Steps 1-11 of the roles/permissions
# rebuild require the old JSON-based system to stay fully functional and
# untouched), and RoleDefinition's `rank` field is required — reusing the
# same class would make old-system PATCH calls that edit positions without a
# rank start failing validation. They merge back into one class in Step 12
# once VolunteerSchema/PositionDefinition are deleted.
# ---------------------------------------------------------------------------
class RoleDefinition(BaseModel):
    key: str                    # snake_case identifier, matches TournamentMembershipRole assignments
    label: str                  # human-readable name shown in the UI
    permissions: list[str] = [] # subset of ALL_PERMISSIONS from permissions.py
    rank: int                   # lower = higher authority; see TournamentRole.rank

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

    @field_validator("rank")
    @classmethod
    def validate_rank(cls, v: int) -> int:
        if v < 1:
            raise ValueError("rank must be a positive integer")
        return v


class RoleUpdate(BaseModel):
    """Partial update — all fields optional."""
    key: str | None = None
    label: str | None = None
    permissions: list[str] | None = None
    rank: int | None = None

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str | None) -> str | None:
        if v is not None and not v.replace("_", "").isalnum():
            raise ValueError("key must be snake_case alphanumeric")
        return v

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        invalid = [p for p in v if p not in ALL_PERMISSIONS]
        if invalid:
            raise ValueError(
                f"Invalid permissions: {invalid}. Must be one of: {ALL_PERMISSIONS}"
            )
        return v

    @field_validator("rank")
    @classmethod
    def validate_rank(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("rank must be a positive integer")
        return v


class RoleRead(BaseModel):
    id: int
    tournament_id: int
    key: str
    label: str
    permissions: list[str]
    rank: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RoleAssignmentUpdate(BaseModel):
    """
    Batch add/remove for a membership's roles — one PATCH covers "add these,
    remove those, maybe both at once" instead of one call per role, which
    also keeps the audit log to a single entry per staff action instead of
    one row per role touched.
    """
    add: list[int] = []
    remove: list[int] = []
