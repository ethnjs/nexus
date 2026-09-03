from __future__ import annotations
from pydantic import BaseModel


class DisplayConfigSection(BaseModel):
    """One section of the member panel, in the order the TD arranged them.

    A built-in section carries only `id` plus what's turned off inside it. A
    TD-created one ("custom:{uuid}") also carries a `title` and the custom
    fields assigned to it — those are the only sections whose membership is
    user-defined, so `fields` is meaningless on a built-in and ignored there.
    """
    id: str
    hidden: bool = False
    # Field ids within this section that are turned off — only meaningful for
    # a section that holds more than one (Membership, Education, Logistics).
    hidden_fields: list[str] = []
    # Custom sections only.
    title: str | None = None
    fields: list[str] = []


class DisplayConfigSort(BaseModel):
    """The members table's sort, remembered per viewer. Sorting is done in
    the client (the roster is a single page), so this is view state the
    server only stores and validates."""
    field: str
    direction: str = "asc"


class DisplayConfigSurface(BaseModel):
    """One UI surface's saved configuration, for one member. Every field is
    optional and every reader falls back to a default, so a surface saved
    before a given feature existed keeps working untouched.

    Surfaces and namespaces are only validated on write (see the PUT route);
    this schema itself accepts any string so a stale/dangling item never
    fails to parse on read.

    The whole per-member display_config column is dict[str, DisplayConfigSurface]
    (surface key -> this) — no wrapper schema needed for that; FastAPI
    handles a plain dict type as both a request body and a response model.
    """
    # Namespaced strings like "track:3" or "lunch_category:entree". Used by
    # the panel to drop individual items from a section's contents.
    hidden: list[str] = []
    # Members table only: the visible columns, in display order. Absent means
    # "the default set" — not "no columns", which is why it's None, not [].
    columns: list[str] | None = None
    # Member panel only: section order plus per-section visibility. Absent
    # means the default order with everything shown. A built-in section
    # missing from a saved list still renders, appended in default order, so
    # adding a new section type never requires a migration.
    sections: list[DisplayConfigSection] | None = None
    # Members table only: the viewer's committed filters, keyed by the roster
    # query param each set belongs to ({"track": ["3:confirmed"], ...}). An
    # empty dict and None both mean "no filters" — the client clears by
    # sending {}, so this never has to distinguish them.
    filters: dict[str, list[str]] | None = None
    # Members table only. Absent means the client's own default sort.
    sort: DisplayConfigSort | None = None


class DisplayConfigCatalogItem(BaseModel):
    """One toggleable item in the config modal's catalog — key is the exact
    namespaced string a Toggle writes into `hidden`, label is what's shown."""
    key: str
    label: str


class DisplayConfigSectionCatalogItem(BaseModel):
    """One built-in panel section a TD can reorder, hide, or hide pieces of."""
    id: str
    label: str
    fields: list[DisplayConfigCatalogItem] = []


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
    # Members table: every column that can be turned on, fixed ones first
    # then the per-entity ones, in the order the modal should list them.
    columns: list[DisplayConfigCatalogItem] = []
    # Member panel: the built-in sections and their individually hideable
    # fields. Custom sections aren't here — the TD creates those.
    sections: list[DisplayConfigSectionCatalogItem] = []
