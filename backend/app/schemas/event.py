from __future__ import annotations

from pydantic import BaseModel


class EventCategoryResponse(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class EventCategoryCreate(BaseModel):
    name: str


class EventCategoryUpdate(BaseModel):
    name: str


class RelatedEventResponse(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class EventResponse(BaseModel):
    id: int
    name: str
    category: EventCategoryResponse
    # Both directions of the pairs in event_relationships, by name.
    related_events: list[RelatedEventResponse] = []

    model_config = {"from_attributes": True}


class EventCreate(BaseModel):
    name: str
    category_id: int


class EventRelationshipCreate(BaseModel):
    related_event_id: int


class EventUpdate(BaseModel):
    name: str | None = None
    category_id: int | None = None
