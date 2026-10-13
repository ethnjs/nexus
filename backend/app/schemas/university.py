from __future__ import annotations

from pydantic import BaseModel


# Request Schema
class UniversityCreate(BaseModel):
    name: str
    abbreviation: str | None = None
    location: str | None = None

# Request Schema
class UniversityUpdate(BaseModel):
    name: str | None = None
    abbreviation: str | None = None
    location: str | None = None

# Response Schema
class UniversityResponse(BaseModel):
    id: int
    name: str
    abbreviation: str | None = None
    location: str | None = None

    model_config = {"from_attributes": True}