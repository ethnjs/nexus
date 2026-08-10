from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel

from app.schemas.tournament.membership import MembershipSlimResponse
from app.schemas.tournament.role import RoleRead
from app.schemas.user import UserSlimResponse


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
    actor: MembershipSlimResponse | UserSlimResponse
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
