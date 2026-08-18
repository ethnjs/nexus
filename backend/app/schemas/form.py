from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, model_validator

# ---------------------------------------------------------------------------
# Form Field Schemas
# ---------------------------------------------------------------------------

class FormFieldRead(BaseModel):
    id: int
    form_id: int
    field_key: str | None = None
    order: int
    label: str
    description: str | None = None
    question_type: str
    is_archived: bool = False
    config: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FormFieldCreate(BaseModel):
    label: str
    question_type: str
    description: str | None = None
    field_key: str | None = None
    order: int | None = None
    config: dict[str, Any] | None = None


class FormFieldUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    question_type: str | None = None
    order: int | None = None
    config: dict | None = None

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Form Schemas
# ---------------------------------------------------------------------------

class FormRead(BaseModel):
    id: int
    name: str
    description: str | None = None
    status: Literal["draft", "published", "archived"]
    tournament_ids: list[int] = []
    chapter_ids: list[int] = []
    created_by: int
    created_at: datetime
    updated_at: datetime
    fields: list[FormFieldRead] = []

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def _flatten_links(cls, obj):
        # ORM objects expose tournament_ids/chapter_ids via the
        # FormTournament/FormChapter join rows, not a plain column.
        if isinstance(obj, dict):
            return obj
        return {
            "id": obj.id,
            "name": obj.name,
            "description": obj.description,
            "status": obj.status,
            "tournament_ids": [link.tournament_id for link in obj.tournament_links],
            "chapter_ids": [link.chapter_id for link in obj.chapter_links],
            "created_by": obj.created_by,
            "created_at": obj.created_at,
            "updated_at": obj.updated_at,
            "fields": obj.fields,
        }


class FormCreate(BaseModel):
    name: str
    description: str | None = None
    tournament_ids: list[int] = []
    chapter_ids: list[int] = []

    @model_validator(mode="after")
    def _require_at_least_one_owner(self):
        if not self.tournament_ids and not self.chapter_ids:
            raise ValueError("Form must be linked to at least one tournament or chapter")
        return self


class FormUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: Literal["draft", "published", "archived"] | None = None


# ---------------------------------------------------------------------------
# Form Response / Answer Schemas
# ---------------------------------------------------------------------------

class FormAnswerCreate(BaseModel):
    field_id: int
    value: Any


class FormAnswerRead(BaseModel):
    id: int
    field_id: int
    value: Any

    model_config = ConfigDict(from_attributes=True)


class FormResponseCreate(BaseModel):
    answers: list[FormAnswerCreate]


class FormResponseRead(BaseModel):
    id: int
    form_id: int
    user_id: int
    submitted_at: datetime
    updated_at: datetime
    answers: list[FormAnswerRead] = []

    model_config = ConfigDict(from_attributes=True)
