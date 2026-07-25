from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


class EventCategoryResponse(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class EventCategoryCreate(BaseModel):
    name: str


class EventCategoryUpdate(BaseModel):
    name: str


class EventResponse(BaseModel):
    id: int
    name: str
    category: EventCategoryResponse

    model_config = {"from_attributes": True}


class EventCreate(BaseModel):
    name: str
    category_id: int


class EventUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[int] = None