from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, EmailStr

from app.schemas.person import PersonRefResponse
from app.schemas.tournament import TournamentPublic


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
    creator: PersonRefResponse

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


class JoinRedeemRequest(BaseModel):
    """Optional body for POST /join/. `age_disclosure_consent` only matters
    for a tournament join code that collects an age flag — a chapter code,
    or a tournament that collects neither flag, ignores it."""
    age_disclosure_consent: bool = False


class JoinRedeemResponse(BaseModel):
    """Response for POST /join/ — tells the caller which onboarding flow was
    just completed, so the frontend can route (e.g. to tournament vs. chapter
    onboarding) off a single generic endpoint."""

    type: Literal["tournament", "chapter"]
    target_id: int
    membership_id: int


class JoinPreviewTournament(TournamentPublic):
    """type=="tournament" branch of JoinPreviewResponse — public, read-only,
    so an invite link can show what's being joined before the visitor is
    even signed in. Shares its fields with TournamentSummary via
    TournamentPublic; adds only what this route needs on top."""

    type: Literal["tournament"] = "tournament"
    target_id: int


class JoinPreviewChapter(BaseModel):
    """type=="chapter" branch of JoinPreviewResponse — placeholder until
    chapter invites are built; target_id is all GET /join/preview/ can
    resolve for a chapter code today."""

    type: Literal["chapter"] = "chapter"
    target_id: int


# Response for GET /join/preview/ — a discriminated union on `type`, mirroring
# JoinRedeemResponse's tournament/chapter split.
JoinPreviewResponse = JoinPreviewTournament | JoinPreviewChapter
