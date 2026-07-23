from __future__ import annotations
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, EmailStr, ConfigDict

from university import UniversityResponse

# Request Schema

class ChapterUpdate(BaseModel):
    id: int
    name: Optional[str] = None

class ChapterCreate(BaseModel):
    name: str
    university_id: int
    created_at: datetime

class AssignLeadRequest(BaseModel):
    user_id: int

# Response Schema
class ChapterResponse(BaseModel):
    id: int
    name: str
    university: UniversityResponse
    created_at: datetime

class ChapterUserSlimReponse(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: EmailStr
    phone: Optional[str] = None
    pronouns: Optional[str] = None
    is_active: bool
    major: Optional[str] = None
    year_level: Optional[int] = None
    graduation_year: Optional[int] = None
    employer: Optional[str] = None
    has_competition_experience: Optional[bool] = None
    has_volunteer_experience: Optional[bool] = None
    competition_exerience: list[CompetitionExperienceResponse] = []
    volunteer_experience: list[VolunteerExperienceResponse] = []
    shirt_size: Optional[str] = None
    dietary_restriction: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class ChapterMemberResponse(BaseModel):
    role: str
    joined_at: datetime
    user: ChapterUserSlimReponse

    model_config = ConfigDict(from_attributes=True)