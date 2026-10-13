from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.phone import normalize_phone as _normalize_phone
from app.schemas.university import UniversityResponse
from app.schemas.user_experience import CompetitionExperienceResponse, VolunteerExperienceResponse

ROLE = Literal["admin", "user"]
USER_STATUS = Literal["active", "invited", "deactivated", "locked"]
STUDENT_STATUS = Literal["Undergraduate", "Graduate", "Non-Student"]


class UserUpdate(BaseModel):
    """Partial update — all fields optional."""

    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    date_of_birth: date | None = None
    pronouns: str | None = None

    student_status: STUDENT_STATUS | None = None
    university_id: int | None = None
    major: str | None = None
    year_level: int | None = None
    graduation_year: int | None = None

    employer: str | None = None

    has_competition_experience: bool | None = None
    has_volunteer_experience: bool | None = None

    shirt_size: str | None = None
    dietary_restriction: str | None = None

    @field_validator("first_name", "last_name", "phone")
    @classmethod
    def reject_null(cls, v):
        if v is None:
            raise ValueError("Cannot be null")
        return v

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, v: str | None) -> str | None:
        return _normalize_phone(v)


class AdminUserUpdate(BaseModel):
    role: Literal["user", "admin"] | None = None
    status: USER_STATUS | None = None


class UserSlimResponse(BaseModel):
    id: int
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr
    phone: str | None = None
    pronouns: str | None = None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AdminUserSlimResponse(UserSlimResponse):
    email_verified: bool
    role: ROLE
    status: USER_STATUS


class UserMeSlimResponse(AdminUserSlimResponse):
    is_profile_complete: bool = False
    is_onboarding_complete: bool = False


class UserFullResponse(UserSlimResponse):
    student_status: STUDENT_STATUS | None = None
    university: UniversityResponse | None = None
    major: str | None = None
    year_level: int | None = None
    graduation_year: int | None = None

    employer: str | None = None

    has_competition_experience: bool | None = None
    has_volunteer_experience: bool | None = None

    competition_experience: list[CompetitionExperienceResponse] = []
    volunteer_experience: list[VolunteerExperienceResponse] = []

    shirt_size: str | None = None
    dietary_restriction: str | None = None


class OwnedTournamentRef(BaseModel):
    id: int
    name: str
    short_name: str | None = None
    is_archived: bool

    model_config = {"from_attributes": True}


class AdminUserFullResponse(UserFullResponse, AdminUserSlimResponse):
    # Read off User.tournaments. The admin delete confirmation lists these —
    # they survive the delete but are left without an owner.
    owned_tournaments: list[OwnedTournamentRef] = Field(default=[], validation_alias="tournaments")


class UserMeFullResponse(UserFullResponse, UserMeSlimResponse):
    date_of_birth: date | None = None
    missing_profile_fields: list[str] = []
