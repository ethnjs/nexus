from __future__ import annotations
from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, field_validator, computed_field
from app.core.phone import normalize_phone as _normalize_phone


ROLE = Literal["admin", "user"]
STUDENT_STATUS = Literal["Undergraduate", "Graduate", "Non-Student"]


class UserUpdate(BaseModel):
    """Partial update — all fields optional."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None

    student_status: Optional[STUDENT_STATUS] = None
    university: Optional[str] = None
    major: Optional[str] = None
    year_level: Optional[int] = None
    graduation_year: Optional[int] = None

    employer: Optional[str] = None
    
    competition_exp: Optional[str] = None
    volunteering_exp: Optional[str] = None

    shirt_size: Optional[str] = None
    dietary_restriction: Optional[str] = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email address")
        return v.lower().strip()

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, v: Optional[str]) -> str | None:
        return _normalize_phone(v)

class AdminUserUpdate(BaseModel):
    role: Optional[Literal["user", "admin"]] = None
    is_active: Optional[bool] = None

class UserResponse(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: str
    phone: Optional[str] = None

    role: ROLE
    is_active: bool
    
    student_status: Optional[STUDENT_STATUS] = None
    university: Optional[str] = None
    major: Optional[str] = None
    year_level: Optional[int] = None
    graduation_year: Optional[int] = None

    employer: Optional[str] = None
    
    competition_exp: Optional[str] = None
    volunteering_exp: Optional[str] = None

    shirt_size: Optional[str] = None
    dietary_restriction: Optional[str] = None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def missing_profile_fields(self) -> list[str]:
        always_required = ["phone", "competition_exp", "volunteering_exp", "shirt_size", "dietary_restriction"]
        missing = [f for f in always_required if not getattr(self, f)]

        if not self.student_status:
            missing.append("student_status")
        elif self.student_status == "Non-Student" and not self.employer:
            missing.append("employer")
        else:
            school_required = ["university", "major", "year_level", "graduation_year"]
            for f in school_required:
                if not getattr(self, f):
                    missing.append(f)
            

        return missing
