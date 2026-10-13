from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class SessionResponse(BaseModel):
    """GET /users/me/sessions/ — one row per active session."""
    id: int
    user_agent: str | None = None
    ip_address: str | None = None
    created_at: datetime
    last_active_at: datetime | None = None
    is_current: bool

    model_config = {"from_attributes": True}
