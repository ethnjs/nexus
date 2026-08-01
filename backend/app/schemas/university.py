from __future__ import annotations
from typing import Optional
from pydantic import BaseModel

# Request Schema
class UniversityCreate(BaseModel):
    name: str
    abbreviation: Optional[str] = None
    location: Optional[str] = None

# Request Schema
class UniversityUpdate(BaseModel):
    name: Optional[str] = None
    abbreviation: Optional[str] = None
    location: Optional[str] = None

# Response Schema
class UniversityResponse(BaseModel):
    id: int
    name: str
    abbreviation: Optional[str] = None
    location: Optional[str] = None