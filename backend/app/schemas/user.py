from __future__ import annotations
from typing import Optional, Literal
from datetime import datetime, date
from pydantic import BaseModel, EmailStr, field_validator, computed_field

from app.core.phone import normalize_phone as _normalize_phone
from app.schemas.user_experience import CompetitionExperienceResponse, VolunteerExperienceResponse


ROLE = Literal["admin", "user"]
USER_STATUS = Literal["active", "invited", "deactivated", "locked"]
STUDENT_STATUS = Literal["Undergraduate", "Graduate", "Non-Student"]


class UserUpdate(BaseModel):
    """Partial update — all fields optional."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[date] = None
    pronouns: Optional[str] = None

    student_status: Optional[STUDENT_STATUS] = None
    university: Optional[str] = None
    major: Optional[str] = None
    year_level: Optional[int] = None
    graduation_year: Optional[int] = None

    employer: Optional[str] = None

    has_competition_experience: Optional[bool] = None
    has_volunteer_experience: Optional[bool] = None

    shirt_size: Optional[str] = None
    dietary_restriction: Optional[str] = None

    @field_validator("first_name", "last_name", "phone")
    @classmethod
    def reject_null(cls, v):
        if v is None:
            raise ValueError("Cannot be null")
        return v

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, v: Optional[str]) -> str | None:
        return _normalize_phone(v)

class AdminUserUpdate(BaseModel):
    role: Optional[Literal["user", "admin"]] = None
    status: Optional[USER_STATUS] = None

    

class UserSlimResponse(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: EmailStr
    phone: Optional[str] = None
    pronouns: Optional[str] = None

    email_verified: bool
    role: ROLE
    status: USER_STATUS

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class UserMeSlimResponse(UserSlimResponse):
    is_profile_complete: bool = False



class UserFullResponse(UserSlimResponse):
    student_status: Optional[STUDENT_STATUS] = None
    university: Optional[str] = None
    major: Optional[str] = None
    year_level: Optional[int] = None
    graduation_year: Optional[int] = None

    employer: Optional[str] = None

    has_competition_experience: Optional[bool] = None
    has_volunteer_experience: Optional[bool] = None

    competition_experience: list[CompetitionExperienceResponse] = []
    volunteer_experience: list[VolunteerExperienceResponse] = []

    shirt_size: Optional[str] = None
    dietary_restriction: Optional[str] = None
    
class UserMeFullResponse(UserFullResponse):
    date_of_birth: Optional[date] = None
    missing_profile_fields: list[str] = []