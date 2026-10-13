from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from app.schemas.university import UniversityResponse


class ChapterUpdate(BaseModel):
    name: str | None = None
    university_id: int | None = None

class ChapterCreate(BaseModel):
    name: str
    university_id: int

class ChapterResponse(BaseModel):
    id: int
    name: str
    university: UniversityResponse
