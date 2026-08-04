from __future__ import annotations
from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, ConfigDict, model_validator

from app.schemas.university import UniversityResponse
from app.schemas.user import UserSlimResponse, UserFullResponse


class ChapterUpdate(BaseModel):
    name: Optional[str] = None
    university_id: Optional[int] = None

class ChapterCreate(BaseModel):
    name: str
    university_id: int

class AssignLeadRequest(BaseModel):
    user_id: int

class ChapterMemberUpdate(BaseModel):
    role: Literal["lead", "officer", "member"]


class ChapterResponse(BaseModel):
    id: int
    name: str
    university: UniversityResponse

class ChapterMemberResponse(UserSlimResponse):
    membership_id: int
    role: str
    joined_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def _flatten_user(cls, data):
        """Accepts a ChapterMembership ORM object and flattens its .user onto this response."""
        if isinstance(data, dict):
            return data
        return {
            **UserSlimResponse.model_validate(data.user, from_attributes=True).model_dump(),
            "membership_id": data.id,
            "role": data.role,
            "joined_at": data.joined_at,
        }

class ChapterMemberProfileResponse(UserFullResponse):
    membership_id: int
    role: str
    joined_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def _flatten_user(cls, data):
        """Accepts a ChapterMembership ORM object and flattens its .user onto this response."""
        if isinstance(data, dict):
            return data
        return {
            **UserFullResponse.model_validate(data.user, from_attributes=True).model_dump(),
            "membership_id": data.id,
            "role": data.role,
            "joined_at": data.joined_at,
        }
