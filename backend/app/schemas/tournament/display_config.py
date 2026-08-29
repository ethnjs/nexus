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
