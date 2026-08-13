from __future__ import annotations
from typing import Literal
from pydantic import BaseModel


class SetupChecklistItem(BaseModel):
    item_key: str
    label: str
    status: Literal["not_started", "complete"]


class SetupChecklistResponse(BaseModel):
    items: list[SetupChecklistItem]
    completed_count: int
    total_count: int
