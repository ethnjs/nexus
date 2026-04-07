from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel


class TournamentCategoryBase(BaseModel):
    name: str


class TournamentCategoryCreate(TournamentCategoryBase):
    pass


class TournamentCategoryRead(TournamentCategoryBase):
    id: int
    tournament_id: int
    is_custom: bool
    created_at: datetime

    model_config = {"from_attributes": True}
