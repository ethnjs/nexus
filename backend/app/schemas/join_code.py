from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel


class JoinCodeResponse(BaseModel):
    id: int
    code: str
    label: str | None = None
    expires_at: datetime | None = None
    is_active: bool
    created_at: datetime
    use_count: int = 0

    model_config = {"from_attributes": True}


class JoinCodeCreate(BaseModel):
    label: str | None = None
    expires_in_hours: int | None = None


class JoinCodeUpdate(BaseModel):
    label: str | None = None
    # Extends expires_at by this many hours from its current value (or from
    # now, if the code currently never expires) — cumulative, not absolute.
    add_hours: int | None = None


class JoinRedeemResponse(BaseModel):
    """Response for POST /join/ — tells the caller which onboarding flow was
    just completed, so the frontend can route (e.g. to tournament vs. chapter
    onboarding) off a single generic endpoint."""

    type: Literal["tournament", "chapter"]
    target_id: int
    membership_id: int
