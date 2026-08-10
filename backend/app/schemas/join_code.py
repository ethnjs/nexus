from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, EmailStr

from app.schemas.user import UserSlimResponse
from app.schemas.tournament.membership import MembershipSlimResponse


class JoinCodeResponse(BaseModel):
    id: int
    code: str
    label: str | None = None
    expires_at: datetime | None = None
    created_at: datetime
    use_count: int = 0
    # The creator's membership row in this tournament — falls back to the
    # bare user when they have none (e.g. a site admin acting without ever
    # joining). created_by is always set; the membership isn't guaranteed.
    creator: MembershipSlimResponse | UserSlimResponse

    model_config = {"from_attributes": True}


class JoinCodeCreate(BaseModel):
    label: str | None = None
    expires_in_hours: int | None = None


class JoinCodeUpdate(BaseModel):
    label: str | None = None
    # Extends expires_at by this many hours from its current value (or from
    # now, if the code currently never expires) — cumulative, not absolute.
    add_hours: int | None = None


class StaffInviteCreate(BaseModel):
    """
    join_code_id must already exist — the frontend creates a new code first
    (POST /join-codes/) if the TD chose "create new code" in the invite
    modal, then calls this with the resulting id. This route only sends.
    """
    join_code_id: int
    emails: list[EmailStr]


class StaffInviteResponse(BaseModel):
    join_code: JoinCodeResponse
    sent: list[str]
    failed: list[str] = []


class JoinRedeemResponse(BaseModel):
    """Response for POST /join/ — tells the caller which onboarding flow was
    just completed, so the frontend can route (e.g. to tournament vs. chapter
    onboarding) off a single generic endpoint."""

    type: Literal["tournament", "chapter"]
    target_id: int
    membership_id: int
