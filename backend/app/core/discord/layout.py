"""What a server's managed roles, categories and channels should be, as pure functions of NEXUS
data. The build compares this with the server's live state; nothing here touches Discord or
the database.

Keys are identities. A role's key names the NEXUS object it mirrors ("role:4", "event:12"); a
channel's key is the set of events it covers ("event:12,13"); a category's is its place
("building:5", "zone:3", "other"). Names are display only and can change without the object
being replaced.
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from app.core.tournament.permissions import MANAGE_DISCORD, MANAGE_TOURNAMENT
from app.models.models import TournamentEvent
from app.services.discord.permissions import ADMINISTRATOR, STAFF_PERMISSIONS, VIEW_CHANNEL

Tier = Literal["admin", "staff"]

OWNER_KEY = "owner"
VERIFIED_KEY = "verified"
OTHER_KEY = "other"
OWNER_ROLE_NAME = "Tournament Owner"
VERIFIED_ROLE_NAME = "Verified"
OTHER_CATEGORY_NAME = "Other Events"
UNPLACED_CATEGORY_NAME = "Events"
MAX_CHANNEL_NAME = 100
MAX_NICKNAME = 32
CATEGORY_CAPACITY = 50


@dataclass(frozen=True)
class Place:
    id: int
    name: str


@dataclass(frozen=True)
class LayoutRole:
    id: int
    label: str
    rank: int
    permissions: frozenset[str]


@dataclass(frozen=True)
class LayoutEvent:
    id: int
    name: str
    division: str | None
    catalog_id: int | None
    catalog_name: str | None
    building: Place | None
    zone: Place | None


@dataclass(frozen=True)
class LayoutSettings:
    merge_divisions: bool
    category_grouping: str


@dataclass(frozen=True)
class RoleSpec:
    key: str
    name: str
    permissions: int
    tier: Tier | None
    # Shown as its own group in the member list. Set only when the role is created.
    hoist: bool = False


@dataclass(frozen=True)
class CategorySpec:
    key: str
    name: str


@dataclass(frozen=True)
class ChannelSpec:
    key: str
    name: str
    category_key: str
    event_ids: tuple[int, ...]


@dataclass(frozen=True)
class Layout:
    """Roles top to bottom, categories in server order, channels in order within each category."""

    roles: tuple[RoleSpec, ...]
    categories: tuple[CategorySpec, ...]
    channels: tuple[ChannelSpec, ...]


def event_name_with_division(event: TournamentEvent) -> str:
    """ "Circuit Lab C". Same convention as the frontend's eventNameWithDivision."""
    name = event.display_name or "Unnamed event"
    return f"{name} {event.division}" if event.division else name


def role_key(role_id: int) -> str:
    return f"role:{role_id}"


def event_role_key(event_id: int) -> str:
    return f"event:{event_id}"


def channel_key(event_ids: Iterable[int]) -> str:
    return "event:" + ",".join(str(i) for i in sorted(event_ids))


def role_tier(permissions: Iterable[str]) -> Tier | None:
    """How a NEXUS role is set up in Discord. Admin roles get Administrator; staff roles get the
    staff permission set and see every channel."""
    held = set(permissions)
    if MANAGE_TOURNAMENT in held:
        return "admin"
    if MANAGE_DISCORD in held:
        return "staff"
    return None


def tier_permissions(tier: Tier | None) -> int:
    if tier == "admin":
        return ADMINISTRATOR
    if tier == "staff":
        return STAFF_PERMISSIONS
    return 0


def slug(name: str) -> str:
    """A channel name: lowercase, each run of other characters a single "-", 1-100 characters."""
    value = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:MAX_CHANNEL_NAME].strip("-")
    return value or "event"


def nickname(first_name: str | None, last_name: str | None) -> str | None:
    """ "Pat S.", cut to fit Discord's 32 characters, or None without a first name."""
    first = " ".join((first_name or "").split())
    if not first:
        return None
    last = (last_name or "").strip()
    initial = f" {last[0].upper()}." if last else ""
    return first[: MAX_NICKNAME - len(initial)].rstrip() + initial


def _sort_name(name: str) -> str:
    return name.casefold()


def compute_layout(
    roles: Iterable[LayoutRole], events: Iterable[LayoutEvent], settings: LayoutSettings
) -> Layout:
    events = list(events)
    categories = _category_specs(events, settings)
    return Layout(
        roles=_role_specs(roles, events),
        categories=tuple(categories),
        channels=_channel_specs(events, settings, [c.key for c in categories]),
    )


def _role_specs(roles: Iterable[LayoutRole], events: list[LayoutEvent]) -> tuple[RoleSpec, ...]:
    nexus = [
        RoleSpec(
            role_key(r.id),
            r.label,
            tier_permissions(t := role_tier(r.permissions)),
            t,
            hoist=t == "admin",
        )
        for r in sorted(roles, key=lambda r: (r.rank, _sort_name(r.label), r.id))
    ]
    event_roles = [
        RoleSpec(event_role_key(e.id), e.name, 0, None)
        for e in sorted(events, key=lambda e: (_sort_name(e.name), e.id))
    ]
    return (
        RoleSpec(OWNER_KEY, OWNER_ROLE_NAME, ADMINISTRATOR, "admin"),
        *nexus,
        *event_roles,
        RoleSpec(VERIFIED_KEY, VERIFIED_ROLE_NAME, VIEW_CHANNEL, None),
    )


def _place(event: LayoutEvent, settings: LayoutSettings) -> Place | None:
    return event.zone if settings.category_grouping == "zone" else event.building


def _base_category_key(place: Place | None, settings: LayoutSettings) -> str:
    return f"{settings.category_grouping}:{place.id}" if place else OTHER_KEY


def _category_specs(events: list[LayoutEvent], settings: LayoutSettings) -> list[CategorySpec]:
    places = {p.id: p for e in events if (p := _place(e, settings)) is not None}
    placed = sorted(places.values(), key=lambda p: (_sort_name(p.name), p.id))
    bases = [CategorySpec(_base_category_key(p, settings), p.name) for p in placed]
    if any(_place(e, settings) is None for e in events):
        bases.append(
            CategorySpec(OTHER_KEY, OTHER_CATEGORY_NAME if placed else UNPLACED_CATEGORY_NAME)
        )

    counts = _channels_per_category(events, settings)
    result = []
    for base in bases:
        for n in range(_chunks(counts.get(base.key, 0))):
            if n == 0:
                result.append(base)
            else:
                result.append(CategorySpec(f"{base.key}:{n + 1}", f"{base.name} ({n + 1})"))
    return result


def _chunks(count: int) -> int:
    return max(1, -(-count // CATEGORY_CAPACITY))


def _groups(events: list[LayoutEvent], settings: LayoutSettings) -> list[list[LayoutEvent]]:
    """Events that share a channel. With division merge on, events of one catalog event in the
    same building or zone share one; unplaced events count as one place. Custom events never
    merge."""
    merged: dict[tuple[int, int | None], list[LayoutEvent]] = {}
    groups: list[list[LayoutEvent]] = []
    for event in events:
        if settings.merge_divisions and event.catalog_id is not None:
            place = _place(event, settings)
            key = (event.catalog_id, place.id if place else None)
            if key not in merged:
                merged[key] = []
                groups.append(merged[key])
            merged[key].append(event)
        else:
            groups.append([event])
    return groups


def _group_name(group: list[LayoutEvent]) -> str:
    if len(group) == 1:
        return group[0].name
    first = group[0]
    divisions = "".join(sorted(e.division for e in group if e.division))
    base = first.catalog_name or first.name
    return f"{base} {divisions}" if divisions else base


def _channels_per_category(events: list[LayoutEvent], settings: LayoutSettings) -> dict[str, int]:
    counts: dict[str, int] = {}
    for group in _groups(events, settings):
        key = _base_category_key(_place(group[0], settings), settings)
        counts[key] = counts.get(key, 0) + 1
    return counts


def _channel_specs(
    events: list[LayoutEvent], settings: LayoutSettings, category_order: list[str]
) -> tuple[ChannelSpec, ...]:
    by_category: dict[str, list[tuple[str, tuple[int, ...]]]] = {}
    for group in _groups(events, settings):
        base = _base_category_key(_place(group[0], settings), settings)
        ids = tuple(sorted(e.id for e in group))
        by_category.setdefault(base, []).append((slug(_group_name(group)), ids))

    result = []
    for base, channels in by_category.items():
        channels.sort(key=lambda c: (c[0], c[1]))
        for i, (name, ids) in enumerate(channels):
            n = i // CATEGORY_CAPACITY
            category = base if n == 0 else f"{base}:{n + 1}"
            result.append(ChannelSpec(channel_key(ids), name, category, ids))
    order = {key: i for i, key in enumerate(category_order)}
    return tuple(sorted(result, key=lambda c: (order[c.category_key], c.name, c.key)))
