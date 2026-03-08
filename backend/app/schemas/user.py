from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, field_validator
import re


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


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    """Partial update — all fields optional. TD manual override."""
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    phone: str | None = None
    shirt_size: str | None = None
    dietary_restriction: str | None = None
    university: str | None = None
    major: str | None = None
    employer: str | None = None
    university: str | None = None
    major: str | None = None
    employer: str | None = None


class UserRead(UserBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}