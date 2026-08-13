from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, field_validator
from app.core.tournament.permissions import ALL_PERMISSIONS


# ---------------------------------------------------------------------------
# Role definition schema — create/update schema for TournamentRole rows.
# ---------------------------------------------------------------------------
class RoleDefinition(BaseModel):
    label: str                  # human-readable name shown in the UI
    permissions: list[str] = [] # subset of ALL_PERMISSIONS from permissions.py
    rank: int                   # lower = higher authority; see TournamentRole.rank

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
    label: str | None = None
    permissions: list[str] | None = None
    rank: int | None = None

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
    label: str
    permissions: list[str]
    rank: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RoleWithMemberCount(RoleRead):
    """
    RoleRead plus the per-role member count — only the role list/CRUD
    endpoints in api/routes/tournament/roles.py compute this (via
    with_member_counts). Roles nested inside membership responses stay plain
    RoleRead, since that count isn't attached there.
    """
    member_count: int


class RoleBulkReorderItem(BaseModel):
    role_id: int
    rank: int

    @field_validator("rank")
    @classmethod
    def validate_rank(cls, v: int) -> int:
        if v < 1:
            raise ValueError("rank must be a positive integer")
        return v


class RoleBulkReorder(BaseModel):
    """
    Body for PATCH /roles/reorder-bulk/ — final rank values computed
    client-side (drag-and-drop preview); the backend just validates
    rank-bound authority and applies them atomically.
    """
    roles: list[RoleBulkReorderItem]


class RoleAssignmentUpdate(BaseModel):
    """
    Batch add/remove for a membership's roles — one PATCH covers "add these,
    remove those, maybe both at once" instead of one call per role, which
    also keeps the audit log to a single entry per staff action instead of
    one row per role touched.
    """
    add: list[int] = []
    remove: list[int] = []
