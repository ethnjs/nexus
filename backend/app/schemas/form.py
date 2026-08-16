from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field

# ==========================================
# Form Field Schemas
# ==========================================

class FormFieldRead(BaseModel):
    id: int
    form_id: int
    field_key: str
    order: int
    label: str
    description: str | None = None
    question_type: str
    required: bool = False
    is_archived: bool = False
    config: dict[str, Any] | None = None

    model_config = ConfigDict(from_attributes=True)


class FormFieldCreate(BaseModel):
    label: str
    question_type: str
    description: str | None = None
    required: bool = False
    config: dict[str, Any] | None = None


# ==========================================
# Form Schemas
# ==========================================

class FormRead(BaseModel):
    id: int
    title: str
    description: str | None = None
    owner_type: Literal["tournament", "chapter", "global"]
    tournament_id: int | None = None
    chapter_id: int | None = None
    created_by: int
    is_published: bool = False
    created_at: datetime
    updated_at: datetime
    fields: list[FormFieldRead] = []

    model_config = ConfigDict(from_attributes=True)


class FormCreate(BaseModel):
    title: str
    description: str | None = None
    owner_type: Literal["tournament", "chapter", "global"]
    tournament_id: int | None = None
    chapter_id: int | None = None


class FormUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    is_published: bool | None = None


class FormFieldUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    question_type: str | None = None
    required: bool | None = None
    order: int | None = None
    config: dict | None = None

    class Config:
        from_attributes = True