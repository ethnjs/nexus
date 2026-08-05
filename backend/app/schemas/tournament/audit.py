from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel


class AuditLogEntryRead(BaseModel):
    id: int
    tournament_id: int
    actor_id: int
    action: str
    target_type: str | None = None
    target_id: int | None = None
    extra_data: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditLogPage(BaseModel):
    items: list[AuditLogEntryRead]
    # Pass back as ?before_id= to fetch the next page. None means no more results.
    next_before_id: int | None = None
