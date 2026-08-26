from __future__ import annotations
from pydantic import BaseModel, field_validator

from app.schemas.form import FormListRead


class OnboardingFormAdd(BaseModel):
    form_id: str


class OnboardingFormReorderItem(BaseModel):
    form_id: str
    order: int

    @field_validator("order")
    @classmethod
    def validate_order(cls, v: int) -> int:
        if v < 1:
            raise ValueError("order must be a positive integer")
        return v


class OnboardingFormReorder(BaseModel):
    """
    Body for PATCH /onboarding-forms/reorder/ — final order values computed
    client-side (drag-and-drop preview); the backend just validates the set
    matches the current onboarding forms and applies them atomically.
    """
    forms: list[OnboardingFormReorderItem]


class OnboardingFormRead(FormListRead):
    tournament_form_id: int
    order: int | None = None
