from __future__ import annotations
from pydantic import BaseModel


class DisplayConfigSurface(BaseModel):
    """One UI surface's hidden-item list — namespaced strings like
    "track:3" or "lunch_category:entree". Surfaces and namespaces are only
    validated on write (see the PUT route); this schema itself accepts any
    string so a stale/dangling item never fails to parse on read.

    The whole display_config column is just dict[str, DisplayConfigSurface]
    (surface key -> this) — no wrapper schema needed for that; FastAPI
    handles a plain dict type as both a request body and a response model.
    """
    hidden: list[str] = []


class DisplayConfigCatalogItem(BaseModel):
    """One toggleable item in the config modal's catalog — key is the exact
    namespaced string a Toggle writes into `hidden`, label is what's shown."""
    key: str
    label: str


class DisplayConfigCatalog(BaseModel):
    """Every hideable item, grouped by kind — surface-agnostic (see
    build_catalog's docstring); the modal applies whichever surface's saved
    `hidden` set is relevant to check these against."""
    tracks: list[DisplayConfigCatalogItem] = []
    # One entry per day the tournament runs shifts on — hiding a day drops
    # that day's shifts from the panel's availability section.
    availability: list[DisplayConfigCatalogItem] = []
    lunch_categories: list[DisplayConfigCatalogItem] = []
    event_preferences: list[DisplayConfigCatalogItem] = []
    custom_fields: list[DisplayConfigCatalogItem] = []
