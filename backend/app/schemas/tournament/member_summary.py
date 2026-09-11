from __future__ import annotations
from pydantic import BaseModel


class AvailabilityOptionCount(BaseModel):
    option_id: str
    label: str
    confirmed: int
    interested: int


class TrackSummary(BaseModel):
    track_id: int
    name: str
    confirmed: int
    interested: int
    declined: int
    pending: int
    # One entry per live availability option on this track; [] for a track
    # with no availability question (e.g. a cosmetic one).
    availability: list[AvailabilityOptionCount]


class OnboardingSummary(BaseModel):
    steps: int
    # Members who finished every step.
    completed: int
    # Members partway through — at least one step done, not all.
    started: int


class MemberSummaryResponse(BaseModel):
    member_count: int
    # null when the tournament has no live onboarding steps.
    onboarding: OnboardingSummary | None
    tracks: list[TrackSummary]
