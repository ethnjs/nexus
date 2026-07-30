from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class SessionResponse(BaseModel):
    """GET /users/me/sessions/ — one row per active session."""
    id: int
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: datetime
    last_active_at: Optional[datetime] = None
    is_current: bool

    model_config = {"from_attributes": True}
