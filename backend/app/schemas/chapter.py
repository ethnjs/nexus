from __future__ import annotations
from typing import Optional
from datetime import datetime
from pydantic import BaseModel

from university import UniversityResponse

# Request Schema

class ChapterUpdate(BaseModel):
    id: int
    name: Optional[str] = None

class ChapterCreate(BaseModel):
    name: str
    university_id: int
    created_at: datetime

# Response Schema
class ChapterResponse(BaseModel):
    id: int
    name: str
    university: UniversityResponse
    created_at: datetime
