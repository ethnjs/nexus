from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.core.tournament.export_presets import OUTPUT_TYPES
from app.schemas.person import PersonRefResponse
from app.schemas.tournament.role import RoleRead


class AuditLogEntryRead(BaseModel):
    id: int
    tournament_id: int
    action: str
    target_type: str | None = None
    target_id: int | None = None
    extra_data: dict | None = None
    created_at: datetime
    # The actor's membership in this tournament — falls back to the bare user
    # when they have none (e.g. a site admin acting without ever joining).
    actor: PersonRefResponse
    # Copied when the entry was written; the name is the fallback once the
    # actor's account is deleted and `actor` carries no name.
    actor_name: str | None = None
    actor_email: str | None = None
    # Current role state, resolved server-side — populated only when
    # target_type == "role" and the role still exists (None for
    # role_deleted, and for the bulk-reorder role_updated variant, which has
    # no single target_id). Lets the frontend show the role's current name
    # without guessing at it from extra_data's diff.
    role: RoleRead | None = None

    model_config = {"from_attributes": True}


class AuditLogPage(BaseModel):
    items: list[AuditLogEntryRead]
    # Pass back as ?before_id= to fetch the next page. None means no more results.
    next_before_id: int | None = None


class AuditLogActor(BaseModel):
    actor: PersonRefResponse
    # Total entries this actor has in this tournament's log — lets the
    # "Filter by User" dropdown sort most-active first.
    count: int


class DataExportLog(BaseModel):
    """An export the browser just copied or downloaded."""

    preset: str = Field(max_length=255)
    track: str | None = Field(default=None, max_length=255)
    # A TORUS export's role and a Duosmium export's division.
    role: str | None = Field(default=None, max_length=255)
    division: str | None = Field(default=None, max_length=4)
    output: str
    fields: list[str]
    # Column labels, for a custom preset; built-ins have a fixed format.
    columns: list[str] | None = None

    @field_validator("output")
    @classmethod
    def _check_output(cls, value: str) -> str:
        if value not in OUTPUT_TYPES:
            raise ValueError(f"Invalid output '{value}'. Must be one of: {sorted(OUTPUT_TYPES)}")
        return value
