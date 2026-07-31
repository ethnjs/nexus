from __future__ import annotations
from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, EmailStr, ConfigDict, Field

from app.schemas.university import UniversityResponse

# Request Schema

class ChapterUpdate(BaseModel):
    name: Optional[str] = None

class ChapterCreate(BaseModel):
    name: str
    university_id: int

class AssignLeadRequest(BaseModel):
    user_id: int

# Response Schema
class ChapterResponse(BaseModel):
    id: int
    name: str
    university: UniversityResponse

class ChapterUserSlimReponse(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: EmailStr
    phone: Optional[str] = None
    pronouns: Optional[str] = None
    status: Literal["active", "invited", "deactivated", "locked"]
    major: Optional[str] = None
    year_level: Optional[int] = None
    graduation_year: Optional[int] = None
    employer: Optional[str] = None
    has_competition_experience: Optional[bool] = None
    has_volunteer_experience: Optional[bool] = None
    competition_experience: list[dict] = []
    volunteer_experience: list[dict] = []
    shirt_size: Optional[str] = None
    dietary_restriction: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class ChapterMemberResponse(BaseModel):
    role: str
    joined_at: datetime
    user: ChapterUserSlimReponse

    model_config = ConfigDict(from_attributes=True)

class ChapterJoinCodeResponse(BaseModel):
    id: int
    code: str
    label: Optional[str] = None
    expires_at: Optional[datetime] = None
    is_active: bool
    created_at: datetime
    use_count: int = 0

class ChapterJoinCodeCreate(BaseModel):
    label: Optional[str] = Field(default=None, max_length=100)
    expires_in_hours: Optional[int] = Field(default=None, ge=1)

class ChapterJoinCodeUpdate(BaseModel):
    is_active: Literal[False] = Field(
        ...,
        description="Must be set to false. Reactivation is not allowed."
    )

class ChapterJoinRequest(BaseModel):
    code: str = Field(..., min_length=8, max_length=8, description="8-character join code")