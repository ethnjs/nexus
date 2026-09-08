"""Named field groups for the event read routes' `fields` query param.

The event-side counterpart to app/core/tournament/field_groups.py, and it
keeps that module's three rules — they are what makes `fields` predictable
rather than a per-route convention:

1. **Omitting `fields` means everything.** An absent param parses to None and
   every consumer treats None as "no narrowing". A caller with no opinion is
   never punished with a surprise-empty response.

2. **An unrequested group is absent from the JSON, not null.** `null` and `[]`
   keep their ordinary meanings — no value, and no rows.

3. **Identity is not a group.** id/tournament_id/the event's own name and
   division always serialize; `fields` selects an event's *data*, and there is
   no caller that wants a row it can't identify.

Two registries rather than one shared generic: the groups, their keys and
their loader strategies are entirely different between memberships and
events, and the only thing genuinely common is the three rules above plus
~20 lines of parsing. Generalizing that would couple the two catalogs for no
saving worth having.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Query, status
from sqlalchemy.orm import joinedload, noload, selectinload


# ---------------------------------------------------------------------------
# Always-present keys — see rule 3.
#
# `event` (the joined canonical catalog row) is here rather than in a group
# because display_name resolves through it: a catalog-linked event leaves its
# own name column null, so withholding it would render the event nameless.
# ---------------------------------------------------------------------------
ALWAYS_KEYS = frozenset({
    "id", "tournament_id", "name", "division", "event_type", "event_id", "event",
    "created_at", "updated_at",
})


@dataclass(frozen=True)
class EventFieldGroup:
    """One name a caller can put in `fields`.

    `keys` are what it serializes; `relationships` are the TournamentEvent
    relationship attributes it reads, loaded eagerly when wanted and
    noload()ed when not — a relationship left on its default lazy strategy
    would issue a query per row for data about to be excluded from the dump.
    """
    name: str
    keys: frozenset[str] = frozenset()
    relationships: tuple[str, ...] = ()


SHIFTS = "shifts"
TRACKS = "tracks"
LOCATION = "location"

GROUPS: dict[str, EventFieldGroup] = {
    SHIFTS: EventFieldGroup(
        name=SHIFTS,
        keys=frozenset({"shifts"}),
        relationships=("shifts",),
    ),
    # The tracks themselves, not just their ids: every staff-side reader wants
    # the track's name and dates, and re-joining them against a separately
    # fetched catalog is the only alternative.
    TRACKS: EventFieldGroup(
        name=TRACKS,
        keys=frozenset({"tracks"}),
        relationships=("tracks",),
    ),
    # Where the event physically happens, plus how many people it wants.
    # Grouped together because they share an audience — this is the day-of
    # logistics block, and a board that only draws chips needs none of it.
    LOCATION: EventFieldGroup(
        name=LOCATION,
        keys=frozenset({"building", "room", "floor", "volunteers_needed"}),
    ),
}

ALL_GROUPS = frozenset(GROUPS)


def parse_fields(raw: str | None) -> frozenset[str] | None:
    """Parse the `fields` query param.

    None (param absent) means everything — rule 1. An empty string is a real
    answer rather than an absent one: it means the caller wants identity and
    nothing else.

    Unknown names 422 rather than being ignored, so a typo surfaces as a
    failed request instead of a silently missing section.
    """
    if raw is None:
        return None
    names = [part.strip() for part in raw.split(",")]
    requested = {name for name in names if name}
    unknown = sorted(requested - ALL_GROUPS)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Unknown field group(s): {', '.join(unknown)}. "
                f"Valid groups: {', '.join(sorted(ALL_GROUPS))}."
            ),
        )
    return frozenset(requested)


def wants(requested: frozenset[str] | None, group: str) -> bool:
    """Whether `group` should be included. None means everything."""
    return requested is None or group in requested


def dump_exclude(requested: frozenset[str] | None) -> set[str] | None:
    """The `exclude` argument for model_dump — the keys of every group the
    caller did not ask for. None when nothing is excluded, so callers can pass
    it straight through either way.

    A flat set, unlike the membership side's dict: no event group prunes keys
    inside a nested object.
    """
    if requested is None:
        return None

    excluded: set[str] = set()
    for name, group in GROUPS.items():
        if name not in requested:
            excluded |= group.keys
    return excluded or None


def loader_options(requested: frozenset[str] | None) -> list:
    """SQLAlchemy options implementing `fields` at the query level.

    Deliberately does NOT emit the joins every response needs regardless —
    the canonical `event` row, mainly. Routes add those; this only expresses
    what varies with `fields`.
    """
    from app.models.models import TournamentEvent, TournamentShift, TournamentTrack

    # Relationships needing a further hop to be usable: a shift's event_count
    # counts the events attached to it, a track read embeds its university.
    NESTED = {
        "shifts": joinedload(TournamentShift.tournament_events),
        "tracks": joinedload(TournamentTrack.university),
    }

    options = []
    for name, group in GROUPS.items():
        included = wants(requested, name)
        for rel in group.relationships:
            attr = getattr(TournamentEvent, rel)
            if not included:
                options.append(noload(attr))
                continue
            option = selectinload(attr)
            nested = NESTED.get(rel)
            options.append(option.options(nested) if nested is not None else option)

    return options


def field_selection(fields: str | None = Query(default=None)) -> frozenset[str] | None:
    """FastAPI dependency for the `fields` query param, so every route that
    supports narrowing gets the same param name, validation and Swagger
    description."""
    return parse_fields(fields)
