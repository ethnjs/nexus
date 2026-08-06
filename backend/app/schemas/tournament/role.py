from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, field_validator, model_validator
from app.core.tournament.permissions import ALL_PERMISSIONS


# ---------------------------------------------------------------------------
# Role definition schema — create/update schema for TournamentRole rows.
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


class RoleReorder(BaseModel):
    """
    Body for PATCH /roles/{role_id}/reorder/. Which neighbor-rank fields are
    required depends on drop_type — see core/tournament/roles.compute_new_rank.
    """
    drop_type: Literal["join_group", "new_rank_between", "new_rank_at_top", "new_rank_at_bottom"]
    target_group_rank: int | None = None  # join_group
    rank_above: int | None = None         # new_rank_between, new_rank_at_bottom
    rank_below: int | None = None         # new_rank_between, new_rank_at_top

    @model_validator(mode="after")
    def validate_fields_for_drop_type(self) -> "RoleReorder":
        required = {
            "join_group": ["target_group_rank"],
            "new_rank_between": ["rank_above", "rank_below"],
            "new_rank_at_top": ["rank_below"],
            "new_rank_at_bottom": ["rank_above"],
        }[self.drop_type]
        missing = [f for f in required if getattr(self, f) is None]
        if missing:
            raise ValueError(f"drop_type '{self.drop_type}' requires: {missing}")
        return self


class RoleAssignmentUpdate(BaseModel):
    """
    Batch add/remove for a membership's roles — one PATCH covers "add these,
    remove those, maybe both at once" instead of one call per role, which
    also keeps the audit log to a single entry per staff action instead of
    one row per role touched.
    """
    add: list[int] = []
    remove: list[int] = []
