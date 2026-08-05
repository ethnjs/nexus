from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, model_validator

from app.schemas.tournament.role import RoleRead
from app.schemas.university import UniversityResponse

class TournamentCreate(BaseModel):
    name: str
    start_date: datetime | None = None
    end_date: datetime | None = None
    university_id: int | None = None
    location: str | None = None
    is_public: bool = False
    registration_opens_at: datetime | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> TournamentCreate:
        if self.start_date and self.end_date:
            if self.end_date < self.start_date:
                raise ValueError("end_date must be after start_date")
        return self


class TournamentUpdate(BaseModel):
    """Partial update — all fields optional."""
    name: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    university_id: int | None = None
    location: str | None = None
    is_public: bool | None = None
    registration_opens_at: datetime | None = None


class TransferOwnershipRequest(BaseModel):
    new_owner_id: int


class TournamentRead(BaseModel):
    id: int
    name: str
    start_date: datetime | None = None
    end_date: datetime | None = None
    university: UniversityResponse | None = None
    location: str | None = None
    is_public: bool
    is_verified: bool
    registration_opens_at: datetime | None = None
    owner_id: int
    roles: list[RoleRead] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
