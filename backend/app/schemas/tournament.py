from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel


class TournamentBase(BaseModel):
    name: str
    date: datetime | None = None
    location: str | None = None


class TournamentCreate(TournamentBase):
    pass


class TournamentRead(TournamentBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}