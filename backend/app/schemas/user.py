from __future__ import annotations
from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, field_validator
from app.core.phone import normalize_phone as _normalize_phone


class UserBase(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str | None = None
    shirt_size: str | None = None
    dietary_restriction: str | None = None
    university: str | None = None
    major: str | None = None
    employer: str | None = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email address")
        return v.lower().strip()

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, v: str | None) -> str | None:
        return _normalize_phone(v)


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    """Partial update — all fields optional."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    shirt_size: Optional[str] = None
    dietary_restriction: Optional[str] = None
    university: Optional[str] = None
    major: Optional[str] = None
    student_status: Optional[str] = None
    employer: Optional[str] = None

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, v: str | None) -> str | None:
        return _normalize_phone(v)

class AdminUserUpdate(BaseModel):
    role: Optional[Literal["user", "admin"]] = None
    is_active: Optional[bool] = None

class UserRead(UserBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
