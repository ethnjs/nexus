from __future__ import annotations
from typing import Optional, Literal
from datetime import datetime, date
from pydantic import BaseModel, EmailStr, field_validator, computed_field

from app.core.phone import normalize_phone as _normalize_phone
from app.schemas.user_experience import CompetitionExperienceResponse, VolunteerExperienceResponse


ROLE = Literal["admin", "user"]
STUDENT_STATUS = Literal["Undergraduate", "Graduate", "Non-Student"]


class UserUpdate(BaseModel):
    """Partial update — all fields optional."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
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

    @field_validator("first_name", "last_name", "email", "phone")
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
    is_active: Optional[bool] = None

    

class UserSlimResponse(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: EmailStr
    phone: Optional[str] = None
    pronouns: Optional[str] = None

    is_over_18: Optional[bool] = None
    is_over_21: Optional[bool] = None

    email_verified: bool
    role: ROLE
    is_active: bool
    
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

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class UserMeSlimResponse(UserSlimResponse):
    date_of_birth: date



class UserFullResponse(UserSlimResponse):
    competition_experience: list[CompetitionExperienceResponse] = []
    volunteer_experience: list[VolunteerExperienceResponse] = []
    
class UserMeFullResponse(UserFullResponse):
    date_of_birth: date

    @computed_field
    @property
    def missing_profile_fields(self) -> list[str]:
        always_required = ["phone", "date_of_birth", "pronouns", "shirt_size", "dietary_restriction"]
        missing = [f for f in always_required if not getattr(self, f)]

        if not self.student_status:
            missing.append("student_status")
        elif self.student_status == "Non-Student":
            if not self.employer:
                missing.append("employer")
        else:
            school_required = ["university", "major", "year_level", "graduation_year"]
            for f in school_required:
                if not getattr(self, f):
                    missing.append(f)
            
        for flag, field_name, exp_list in [
            (self.has_competition_experience, "has_competition_experience", self.competition_experience),
            (self.has_volunteer_experience, "has_volunteer_experience", self.volunteer_experience),
        ]:
            if flag is None:
                missing.append(field_name)
            elif flag is True and not exp_list:
                missing.append(field_name)

        return missing