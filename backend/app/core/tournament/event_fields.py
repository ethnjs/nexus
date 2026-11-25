"""Named field groups for the event read routes' `fields` query param.

The event-side counterpart to app/core/tournament/field_groups.py, keeping
its three rules: omitting `fields` means everything, an unrequested group is
absent from the JSON rather than null, and identity (id, tournament_id, and
the event's own name and division) is never a group. A separate registry because
the groups, their keys, and their loaders have nothing in common with the
membership side.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Query, status
from sqlalchemy.orm import joinedload, raiseload, selectinload

# ---------------------------------------------------------------------------
# Always-present keys — see rule 3.
#
# `event` (the joined canonical catalog row) is here rather than in a group
# because display_name resolves through it: a catalog-linked event leaves its
# own name column null, so withholding it would render the event nameless.
# ---------------------------------------------------------------------------
ALWAYS_KEYS = frozenset(
    {
        "id",
        "tournament_id",
        "name",
        "division",
        "event_type",
        "format",
        "has_impound",
        "has_self_schedule",
        "event_id",
        "event",
        "created_at",
        "updated_at",
    }
)


@dataclass(frozen=True)
class EventFieldGroup:
    """One name a caller can put in `fields`: `keys` are what it serializes,
    `relationships` the TournamentEvent relationships it reads, eager-loaded
    when wanted and raiseloaded when not."""

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
    # The tracks themselves, not just ids: every staff-side reader wants their
    # names and dates.
    TRACKS: EventFieldGroup(
        name=TRACKS,
        keys=frozenset({"tracks"}),
        relationships=("tracks",),
    ),
    # Where the event happens on each track it runs on; a board drawing chips
    # needs none of it.
    LOCATION: EventFieldGroup(
        name=LOCATION,
        keys=frozenset({"track_details"}),
        relationships=("track_details",),
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
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
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
    """Loader options implementing `fields`: a wanted relationship is
    eager-loaded, an unwanted one raiseloaded. Routes add the loads every
    response needs, such as the canonical `event` row."""
    from app.models.models import (
        TournamentEvent,
        TournamentEventTrack,
        TournamentRoom,
        TournamentShift,
        TournamentTrack,
    )

    # Relationships needing a further hop to be usable: a shift's event_count
    # counts the events attached to it, a track read embeds its university.
    NESTED = {
        "shifts": (joinedload(TournamentShift.tournament_events),),
        "tracks": (joinedload(TournamentTrack.university),),
        # The link row renders its rooms and their building's name, and its
        # staffing needs, whose roles ride along on the need's own lazy="joined".
        "track_details": (
            selectinload(TournamentEventTrack.rooms).joinedload(TournamentRoom.building),
            selectinload(TournamentEventTrack.needs),
        ),
    }

    options = []
    for name, group in GROUPS.items():
        included = wants(requested, name)
        for rel in group.relationships:
            attr = getattr(TournamentEvent, rel)
            if not included:
                options.append(raiseload(attr))
                continue
            option = selectinload(attr)
            nested = NESTED.get(rel)
            options.append(option.options(*nested) if nested else option)

    return options


def field_selection(fields: str | None = Query(default=None)) -> frozenset[str] | None:
    """FastAPI dependency for the `fields` query param, so every route that
    supports narrowing gets the same param name, validation and Swagger
    description."""
    return parse_fields(fields)
