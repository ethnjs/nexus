"""Building a server, and putting NEXUS's defaults back over admins' edits (/reset).

One routine does both. The planner compares the layout NEXUS wants (layout.py) with the
server's live state and returns a list of actions; the preview describes that list, and the
real run executes the same list. Every Discord id is saved the moment its object exists, so a
build that crashes or is redeployed picks up where it stopped when run again.

Action targets are keys, not ids: an action that needs an object created earlier in the same
run (a channel's category, an event role in its overwrites) resolves the key when it runs.
"""

import asyncio
import contextlib
import dataclasses
import functools
import logging
from collections import Counter
from collections.abc import Awaitable, Callable, Generator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from itertools import count
from typing import Any

from sqlalchemy import ColumnElement, or_
from sqlalchemy.orm import Session

from app.core.discord.layout import (
    CATEGORY_CAPACITY,
    FIXED_CHANNEL_KEYS,
    INFORMATION_KEYS,
    OWNER_KEY,
    VERIFIED_KEY,
    ChannelSpec,
    FixedChannelSpec,
    Layout,
    LayoutEvent,
    LayoutRole,
    LayoutSettings,
    Occupancy,
    Place,
    RoleSpec,
    chunk_key,
    chunk_name,
    chunk_of,
    compute_layout,
    event_name_with_division,
    event_role_key,
)
from app.core.discord.marks import mark_full
from app.core.oauth import frontend_redirect
from app.core.tournament.zones import resolve_track_zones
from app.models.discord import DiscordGuildLink, DiscordManagedChannel, DiscordManagedRole
from app.models.models import (
    TournamentBuilding,
    TournamentEvent,
    TournamentEventTrack,
    TournamentRole,
    TournamentZone,
    utcnow,
)
from app.services.discord import rest as discord_rest
from app.services.discord.permissions import (
    ADMINISTRATOR,
    EVERYONE_REVOKED,
    POSTING,
    STAFF_OVERWRITE,
    VERIFY_EVERYONE_ALLOW,
    VERIFY_EVERYONE_DENY,
    VIEW_CHANNEL,
)
from app.services.discord.rest import (
    GUILD_CATEGORY,
    GUILD_TEXT,
    MEMBER_OVERWRITE,
    ROLE_OVERWRITE,
    DiscordRest,
)

log = logging.getLogger(__name__)

VERIFY_KEY = "verify"
ARCHIVED_KEY = "archived"
VERIFY_CHANNEL_NAME = "verify"
ARCHIVED_CATEGORY_NAME = "Archived"
MAX_ROLES = 250
MAX_CHANNELS = 500
STALE_BUILD_MINUTES = 2
HEARTBEAT_SECONDS = 30
GUIDES_URL = "https://docs.ethanshih.com/docs/nexus"
STAFF_GUIDE_URL = f"{GUIDES_URL}/discord"
VOLUNTEER_GUIDE_URL = f"{GUIDES_URL}/volunteer-guides/discord"

CREATE = "Create"
ADOPT = "Adopt"
UNDO = "Undo hand edits"
STAFF = "Staff access"
ARCHIVE = "Archive"
GROUP_ORDER = (CREATE, ADOPT, UNDO, STAFF, ARCHIVE)
GATE_NOTICE = (
    "Unverified members will no longer see any channel except #verify, and members' nicknames "
    "will be set to their NEXUS names."
)

EVERYONE = "everyone"
TOP = "top"
# target -> (allow, deny). A target is EVERYONE or a role key.
OverwriteSpec = dict[str, tuple[int, int]]


@dataclass(frozen=True)
class Overwrite:
    type: int
    allow: int
    deny: int


# -- What NEXUS manages ------------------------------------------------------------------


@dataclass
class Snapshot:
    link_id: int
    guild_id: int
    tournament_id: int
    built: bool
    layout: Layout
    role_ids: dict[str, int]
    tiers: dict[str, str | None]
    # Live (unarchived) managed categories, event and fixed channels, VERIFY_KEY, and the
    # Archived categories (ARCHIVED_KEY, then "archived:2" and on).
    channel_ids: dict[str, int]
    verify_message_id: int | None
    # The layout again, with channels placed where the server has room (fit_to_server).
    relayout: Callable[[Occupancy], Layout]

    def role_key_for(self, role_id: int) -> str | None:
        return next((k for k, v in self.role_ids.items() if v == role_id), None)

    def channel_key_for(self, channel_id: int) -> str | None:
        return next((k for k, v in self.channel_ids.items() if v == channel_id), None)


def load_snapshot(db: Session, link_id: int) -> Snapshot:
    link = db.get(DiscordGuildLink, link_id)
    assert link is not None
    roles = [
        LayoutRole(r.id, r.label, r.rank, frozenset(r.permissions or []))
        for r in db.query(TournamentRole).filter(TournamentRole.tournament_id == link.tournament_id)
    ]
    zone_of = resolve_track_zones(db, link.track_id)
    zones = {
        z.id: Place(z.id, z.name)
        for z in db.query(TournamentZone).filter(TournamentZone.track_id == link.track_id)
    }
    buildings = {
        b.id: Place(b.id, b.name)
        for b in db.query(TournamentBuilding).filter(
            TournamentBuilding.tournament_id == link.tournament_id
        )
    }
    events = []
    for placement, event in (
        db.query(TournamentEventTrack, TournamentEvent)
        .join(TournamentEvent, TournamentEvent.id == TournamentEventTrack.tournament_event_id)
        .filter(TournamentEventTrack.track_id == link.track_id)
    ):
        zone_id = zone_of.get(event.id)
        events.append(
            LayoutEvent(
                id=event.id,
                name=event_name_with_division(event),
                division=event.division,
                catalog_id=event.event_id,
                catalog_name=event.display_name if event.event_id else None,
                building=buildings.get(placement.building_id) if placement.building_id else None,
                zone=zones.get(zone_id) if zone_id else None,
            )
        )
    relayout = functools.partial(
        compute_layout, roles, events, LayoutSettings(link.merge_divisions, link.category_grouping)
    )
    layout = relayout(Occupancy())

    role_ids: dict[str, int] = {}
    tiers: dict[str, str | None] = {OWNER_KEY: "admin", VERIFIED_KEY: None}
    for row in link.managed_roles:
        key = f"{row.kind}:{row.nexus_id}"
        role_ids[key] = row.discord_role_id
        tiers[key] = row.tier
    if link.owner_role_id:
        role_ids[OWNER_KEY] = link.owner_role_id
    if link.verified_role_id:
        role_ids[VERIFIED_KEY] = link.verified_role_id

    channel_ids = {
        row.key: row.discord_channel_id for row in link.managed_channels if not row.archived
    }
    if link.verify_channel_id:
        channel_ids[VERIFY_KEY] = link.verify_channel_id
    if link.archived_category_id:
        channel_ids[ARCHIVED_KEY] = link.archived_category_id

    return Snapshot(
        link_id=link.id,
        guild_id=link.guild_id,
        tournament_id=link.tournament_id,
        built=link.built_at is not None,
        layout=layout,
        role_ids=role_ids,
        tiers=tiers,
        channel_ids=channel_ids,
        verify_message_id=link.verify_message_id,
        relayout=relayout,
    )


# -- What the server has -----------------------------------------------------------------


@dataclass
class LiveRole:
    id: int
    name: str
    permissions: int
    position: int
    managed: bool


@dataclass
class LiveChannel:
    id: int
    type: int
    name: str
    parent_id: int | None
    position: int
    overwrites: dict[int, Overwrite]


@dataclass
class Live:
    guild_id: int
    owner_id: int
    roles: dict[int, LiveRole]
    channels: dict[int, LiveChannel]
    bot_role_ids: set[int]
    bot_permissions: int
    verify_message_exists: bool

    @property
    def everyone(self) -> LiveRole:
        return self.roles[self.guild_id]

    @property
    def ranked(self) -> list[LiveRole]:
        return ranked_roles(self.roles, self.guild_id)

    def below_bot(self, role_id: int) -> bool:
        """Whether the bot outranks this role, so it can edit, assign and move it."""
        ranked = [r.id for r in self.ranked]
        bot = min((ranked.index(i) for i in self.bot_role_ids if i in ranked), default=-1)
        return role_id in ranked and ranked.index(role_id) > bot >= 0


def parse_roles(data: list[dict[str, Any]]) -> dict[int, LiveRole]:
    return {
        int(r["id"]): LiveRole(
            int(r["id"]), r["name"], int(r["permissions"]), r["position"], bool(r.get("managed"))
        )
        for r in data
    }


def parse_channels(data: list[dict[str, Any]]) -> dict[int, LiveChannel]:
    return {
        int(c["id"]): LiveChannel(
            id=int(c["id"]),
            type=c["type"],
            name=c.get("name", ""),
            parent_id=int(c["parent_id"]) if c.get("parent_id") else None,
            position=c.get("position", 0),
            overwrites={
                int(o["id"]): Overwrite(o["type"], int(o["allow"]), int(o["deny"]))
                for o in c.get("permission_overwrites", [])
            },
        )
        for c in data
    }


async def fetch_live(rest: DiscordRest, snapshot: Snapshot) -> Live:
    guild = await rest.guild(snapshot.guild_id)
    roles = parse_roles(guild["roles"])
    channels = parse_channels(await rest.channels(snapshot.guild_id))
    me = await rest.member(snapshot.guild_id, await rest.me())
    bot_roles = [roles[int(r)] for r in (me or {}).get("roles", []) if int(r) in roles]
    permissions = roles[snapshot.guild_id].permissions
    for role in bot_roles:
        permissions |= role.permissions
    verify_id = snapshot.channel_ids.get(VERIFY_KEY)
    message_exists = bool(
        verify_id
        and snapshot.verify_message_id
        and verify_id in channels
        and await rest.message_exists(verify_id, snapshot.verify_message_id)
    )
    return Live(
        guild_id=snapshot.guild_id,
        owner_id=int(guild["owner_id"]),
        roles=roles,
        channels=channels,
        bot_role_ids={r.id for r in bot_roles},
        bot_permissions=permissions,
        verify_message_exists=message_exists,
    )


def fit_to_server(snapshot: Snapshot, live: Live, *, moving: bool) -> Snapshot:
    """The snapshot with its event channels placed in categories that have room. Discord refuses
    a category's 51st channel, and an adopted category, or one channels were added to since
    the last build, may already hold some. `moving` is for a reset, which moves channels."""
    managed_ids = set(snapshot.channel_ids.values())
    category_of = {
        channel_id: key
        for key, channel_id in snapshot.channel_ids.items()
        if channel_id in live.channels and live.channels[channel_id].type == GUILD_CATEGORY
    }
    # A category the build would adopt by name counts as already managed.
    unmanaged: dict[str, list[int]] = {}
    for c in live.channels.values():
        if c.type == GUILD_CATEGORY and c.id not in managed_ids:
            unmanaged.setdefault(c.name, []).append(c.id)
    for spec in snapshot.layout.categories:
        if spec.key not in category_of.values() and len(unmanaged.get(spec.name, [])) == 1:
            category_of[unmanaged[spec.name][0]] = spec.key

    layout_keys = {
        snapshot.channel_ids[c.key]: c.key
        for c in snapshot.layout.channels
        if c.key in snapshot.channel_ids
    }
    current: dict[str, str | None] = {}
    taken: Counter[str] = Counter()
    for c in live.channels.values():
        if c.type == GUILD_CATEGORY or c.parent_id is None:
            continue
        category = category_of.get(c.parent_id)
        if (key := layout_keys.get(c.id)) is not None:
            current[key] = category
        elif category is not None:
            taken[category] += 1
    layout = snapshot.relayout(Occupancy(current, taken, moving))
    return dataclasses.replace(snapshot, layout=layout)


# -- Actions -----------------------------------------------------------------------------


class Store:
    """Saves what the build creates. Each call commits on its own, so a crash loses nothing that
    already exists in Discord."""

    def __init__(self, session_scope: Callable[[], contextlib.AbstractContextManager[Session]]):
        self._scope = session_scope

    @contextlib.contextmanager
    def _link(self, link_id: int) -> Generator[tuple[Session, DiscordGuildLink]]:
        with self._scope() as db:
            link = db.get(DiscordGuildLink, link_id)
            assert link is not None
            yield db, link
            db.commit()

    def save_role(self, link_id: int, key: str, role_id: int, tier: str | None) -> None:
        with self._link(link_id) as (db, link):
            if key == OWNER_KEY:
                link.owner_role_id = role_id
            elif key == VERIFIED_KEY:
                link.verified_role_id = role_id
            else:
                kind, nexus_id = key.split(":")
                row = (
                    db.query(DiscordManagedRole)
                    .filter_by(link_id=link_id, kind=kind, nexus_id=int(nexus_id))
                    .first()
                )
                if row is None:
                    row = DiscordManagedRole(link_id=link_id, kind=kind, nexus_id=int(nexus_id))
                    db.add(row)
                row.discord_role_id = role_id
                row.tier = tier

    def save_channel(self, link_id: int, key: str, channel_id: int) -> None:
        with self._link(link_id) as (db, link):
            if key == VERIFY_KEY:
                link.verify_channel_id = channel_id
                link.verify_message_id = None
            elif key == ARCHIVED_KEY:
                link.archived_category_id = channel_id
            else:
                row = (
                    db.query(DiscordManagedChannel)
                    .filter_by(link_id=link_id, key=key, archived=False)
                    .first()
                )
                if row is None:
                    if key.startswith("event:"):
                        kind = "event"
                    elif key in FIXED_CHANNEL_KEYS:
                        kind = "channel"
                    else:
                        kind = "category"
                    row = DiscordManagedChannel(link_id=link_id, key=key, kind=kind)
                    db.add(row)
                row.discord_channel_id = channel_id

    def forget_channel(self, link_id: int, key: str) -> None:
        """Stops managing a channel: it's archived, or its key left the layout."""
        with self._link(link_id) as (db, _link):
            for row in db.query(DiscordManagedChannel).filter_by(
                link_id=link_id, key=key, archived=False
            ):
                row.archived = True

    def rekey_channel(self, link_id: int, old_key: str, new_key: str) -> None:
        """A managed event channel now covers a different set of events."""
        with self._link(link_id) as (db, _link):
            row = (
                db.query(DiscordManagedChannel)
                .filter_by(link_id=link_id, key=old_key, archived=False)
                .first()
            )
            if row is not None:
                row.key = new_key

    def forget_role(self, link_id: int, key: str) -> None:
        with self._link(link_id) as (db, link):
            if key == OWNER_KEY:
                link.owner_role_id = None
            elif key == VERIFIED_KEY:
                link.verified_role_id = None
            else:
                kind, nexus_id = key.split(":")
                db.query(DiscordManagedRole).filter_by(
                    link_id=link_id, kind=kind, nexus_id=int(nexus_id)
                ).delete()

    def heartbeat(self, link_id: int) -> None:
        """Shows the build is still alive, so claim_build doesn't take it for dead."""
        with self._link(link_id) as (_db, link):
            link.last_build_at = utcnow()

    def sync_heartbeat(self, link_id: int) -> None:
        """Shows the sync is still alive, so claim_build doesn't take it for dead."""
        with self._link(link_id) as (_db, link):
            link.sync_started_at = utcnow()

    def save_verify_message(self, link_id: int, message_id: int) -> None:
        with self._link(link_id) as (_db, link):
            link.verify_message_id = message_id


@dataclass
class Context:
    rest: DiscordRest
    store: Store
    snapshot: Snapshot
    live: Live
    role_ids: dict[str, int]
    channel_ids: dict[str, int]

    @property
    def guild_id(self) -> int:
        return self.snapshot.guild_id

    def managed_role_ids(self) -> set[int]:
        return set(self.role_ids.values())

    def resolve(self, spec: OverwriteSpec) -> dict[int, Overwrite]:
        result = {}
        for target, (allow, deny) in spec.items():
            target_id = self.guild_id if target == EVERYONE else self.role_ids.get(target)
            if target_id is not None:
                result[target_id] = Overwrite(ROLE_OVERWRITE, allow, deny)
        return result

    def merged(self, channel_id: int | None, spec: OverwriteSpec) -> list[dict[str, Any]]:
        """The default overwrites, plus whatever the channel has for unmanaged roles and for
        individual members, which NEXUS never touches."""
        managed = self.managed_role_ids() | {self.guild_id}
        kept = {}
        if channel_id is not None and channel_id in self.live.channels:
            kept = {
                target: o
                for target, o in self.live.channels[channel_id].overwrites.items()
                if o.type == MEMBER_OVERWRITE or target not in managed
            }
        overwrites = kept | self.resolve(spec)
        return [
            {"id": str(t), "type": o.type, "allow": str(o.allow), "deny": str(o.deny)}
            for t, o in overwrites.items()
        ]

    def parent_id(self, parent: str) -> int | None:
        return None if parent == TOP else self.channel_ids.get(parent)

    async def save(self, fn: Callable[..., None], *args: Any) -> None:
        await asyncio.to_thread(fn, self.snapshot.link_id, *args)


@dataclass
class Action:
    group: str | None
    label: str

    async def run(self, ctx: Context) -> None:
        raise NotImplementedError


@dataclass
class CreateRole(Action):
    spec: RoleSpec

    async def run(self, ctx: Context) -> None:
        role = await ctx.rest.create_role(
            ctx.guild_id,
            name=self.spec.name,
            permissions=self.spec.permissions,
            hoist=self.spec.hoist,
        )
        ctx.role_ids[self.spec.key] = int(role["id"])
        await ctx.save(ctx.store.save_role, self.spec.key, int(role["id"]), self.spec.tier)


@dataclass
class SetUpRole(Action):
    """Adopts an unmanaged role, or puts back a managed one's permissions, name and tier."""

    key: str
    role_id: int
    fields: dict[str, Any]
    tier: str | None

    async def run(self, ctx: Context) -> None:
        if self.fields:
            await ctx.rest.edit_role(ctx.guild_id, self.role_id, **self.fields)
        ctx.role_ids[self.key] = self.role_id
        await ctx.save(ctx.store.save_role, self.key, self.role_id, self.tier)


@dataclass
class SetEveryonePermissions(Action):
    permissions: int

    async def run(self, ctx: Context) -> None:
        await ctx.rest.edit_role(ctx.guild_id, ctx.guild_id, permissions=self.permissions)


@dataclass
class CreateChannel(Action):
    key: str
    name: str
    type: int
    parent: str
    overwrites: OverwriteSpec
    position: int | None = None

    async def run(self, ctx: Context) -> None:
        fields: dict[str, Any] = {
            "name": self.name,
            "type": self.type,
            "permission_overwrites": ctx.merged(None, self.overwrites),
        }
        if (parent_id := ctx.parent_id(self.parent)) is not None:
            fields["parent_id"] = str(parent_id)
        if self.position is not None:
            fields["position"] = self.position
        channel = await ctx.rest.create_channel(ctx.guild_id, **fields)
        ctx.channel_ids[self.key] = int(channel["id"])
        await ctx.save(ctx.store.save_channel, self.key, int(channel["id"]))


@dataclass
class SetUpChannel(Action):
    """Adopts an unmanaged channel or category, or puts back a managed one's defaults. Each of
    name, parent and overwrites is set only when given."""

    key: str
    channel_id: int
    name: str | None = None
    parent: str | None = None
    overwrites: OverwriteSpec | None = None

    async def run(self, ctx: Context) -> None:
        fields: dict[str, Any] = {}
        if self.name is not None:
            fields["name"] = self.name
        if self.parent is not None:
            parent_id = ctx.parent_id(self.parent)
            fields["parent_id"] = str(parent_id) if parent_id is not None else None
        if self.overwrites is not None:
            fields["permission_overwrites"] = ctx.merged(self.channel_id, self.overwrites)
        if fields:
            await ctx.rest.edit_channel(self.channel_id, **fields)
        ctx.channel_ids[self.key] = self.channel_id
        await ctx.save(ctx.store.save_channel, self.key, self.channel_id)


@dataclass
class ArchiveChannel(Action):
    key: str
    channel_id: int
    category_key: str

    async def run(self, ctx: Context) -> None:
        archived = ctx.channel_ids.get(self.category_key)
        assert archived is not None
        await ctx.rest.edit_channel(self.channel_id, parent_id=str(archived))
        await ctx.save(ctx.store.forget_channel, self.key)


@dataclass
class ForgetChannel(Action):
    key: str

    async def run(self, ctx: Context) -> None:
        await ctx.save(ctx.store.forget_channel, self.key)


@dataclass
class AddOverwrite(Action):
    """Gives a managed role its overwrite on a channel, resolving the role's id when it runs."""

    channel_id: int
    role_key: str
    allow: int
    deny: int = 0

    async def run(self, ctx: Context) -> None:
        role_id = ctx.role_ids.get(self.role_key)
        if role_id is not None:
            await ctx.rest.put_overwrite(
                self.channel_id, role_id, allow=self.allow, deny=self.deny, type=ROLE_OVERWRITE
            )


def staff_allow(channel_key: str | None) -> int:
    """What a staff role's overwrite allows on the channel with this key: staff post in
    Information."""
    return STAFF_OVERWRITE | POSTING if channel_key in INFORMATION_KEYS else STAFF_OVERWRITE


def _staff_overwrite(
    group: str | None, label: str, channel_id: int, channel_key: str | None, role_key: str
) -> AddOverwrite:
    return AddOverwrite(group, label, channel_id, role_key, staff_allow(channel_key))


@dataclass
class RemoveStaffAllow(Action):
    """Takes a former staff role's allows off a channel. Its denies stay."""

    channel_id: int
    role_id: int
    current: Overwrite
    staff_allow: int

    async def run(self, ctx: Context) -> None:
        allow = self.current.allow & ~self.staff_allow
        if allow == 0 and self.current.deny == 0:
            await ctx.rest.delete_overwrite(self.channel_id, self.role_id)
        else:
            await ctx.rest.put_overwrite(
                self.channel_id,
                self.role_id,
                allow=allow,
                deny=self.current.deny,
                type=ROLE_OVERWRITE,
            )


@dataclass
class PostVerifyMessage(Action):
    async def run(self, ctx: Context) -> None:
        channel_id = ctx.channel_ids[VERIFY_KEY]
        message = await ctx.rest.send_message(
            channel_id, verify_message(ctx.role_ids.get(VERIFIED_KEY))
        )
        await ctx.save(ctx.store.save_verify_message, int(message["id"]))


@dataclass
class OrderRoles(Action):
    """Puts the managed roles directly below the bot's own, in layout order."""

    keys: list[str]

    async def run(self, ctx: Context) -> None:
        roles = parse_roles((await ctx.rest.guild(ctx.guild_id))["roles"])
        ranked = ranked_roles(roles, ctx.guild_id)
        bot_index = next((i for i, r in enumerate(ranked) if r.id in ctx.live.bot_role_ids), None)
        if bot_index is None:
            return
        below = [r.id for r in ranked[bot_index + 1 :]]
        managed = [ctx.role_ids[k] for k in self.keys if ctx.role_ids.get(k) in below]
        order = managed + [i for i in below if i not in managed]
        if order == below:
            return
        # Discord refuses any position at or above the bot's own, and the bot can't move its own
        # role, so in a server whose roles all share a position there's no room. The preview
        # warned about that.
        if ranked[bot_index].position <= len(order):
            log.warning("No room below the bot's role to reorder roles in %s", ctx.guild_id)
            return
        await ctx.rest.move_roles(
            ctx.guild_id,
            [{"id": str(i), "position": len(order) - n} for n, i in enumerate(order)],
        )


def ranked_roles(roles: dict[int, LiveRole], guild_id: int) -> list[LiveRole]:
    """Top to bottom, @everyone left out. Discord allows equal positions; among those, the role
    with the lower id ranks higher."""
    return sorted(
        (r for r in roles.values() if r.id != guild_id), key=lambda r: (-r.position, r.id)
    )


@dataclass
class OrderChannels(Action):
    """Managed categories after the admins' own, in layout order, then Archived; #verify first
    among channels outside a category; managed channels first within their category."""

    category_keys: list[str]
    channel_keys: list[str]

    async def run(self, ctx: Context) -> None:
        channels = parse_channels(await ctx.rest.channels(ctx.guild_id))

        def ids(keys: list[str]) -> list[int]:
            return [ctx.channel_ids[k] for k in keys if ctx.channel_ids.get(k) in channels]

        def current(items: list[LiveChannel]) -> list[int]:
            return [c.id for c in sorted(items, key=lambda c: (c.position, c.id))]

        categories = [c for c in channels.values() if c.type == GUILD_CATEGORY]
        managed_categories = ids(self.category_keys)
        archived = ids(
            sorted(
                filter(is_archive_key, ctx.channel_ids),
                key=lambda k: chunk_of(k, ARCHIVED_KEY) or 0,
            )
        )
        order = [
            *(i for i in current(categories) if i not in managed_categories and i not in archived),
            *managed_categories,
            *archived,
        ]
        wanted = {channel_id: n for n, channel_id in enumerate(order)}

        managed_channels = ids(self.channel_keys)
        by_parent: dict[int | None, list[LiveChannel]] = {}
        for c in channels.values():
            if c.type != GUILD_CATEGORY:
                by_parent.setdefault(c.parent_id, []).append(c)
        first = ids([VERIFY_KEY])
        for parent_id, items in by_parent.items():
            existing = current(items)
            head = [
                i for i in (managed_channels if parent_id is not None else first) if i in existing
            ]
            for n, channel_id in enumerate(head + [i for i in existing if i not in head]):
                wanted[channel_id] = n

        positions = [
            {"id": str(channel_id), "position": n}
            for channel_id, n in wanted.items()
            if channels[channel_id].position != n
        ]
        if positions:
            await ctx.rest.move_channels(ctx.guild_id, positions)


def verify_message(verified_role_id: int | None) -> dict[str, Any]:
    # The Verified role's id rides in the button, so a click from someone who already has it is
    # answered without a database query.
    return {
        "content": (
            "**Welcome!** This server's channels are for tournament staff.\n"
            "Click **Verify** to get access. You need a NEXUS account linked to your Discord "
            "account, and a role or assignment in this tournament."
        ),
        "components": [
            {
                "type": 1,
                "components": [
                    {
                        "type": 2,
                        "style": 1,
                        "label": "Verify",
                        "custom_id": f"nexus:verify:{verified_role_id or 0}",
                    },
                    {
                        "type": 2,
                        "style": 5,
                        "label": "Link your NEXUS account",
                        "url": frontend_redirect("/connect/discord"),
                    },
                    {"type": 2, "style": 5, "label": "Help", "url": VOLUNTEER_GUIDE_URL},
                ],
            }
        ],
        "allowed_mentions": {"parse": []},
    }


# -- Planning ----------------------------------------------------------------------------


@dataclass
class Plan:
    actions: list[Action] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)
    gate: bool = False

    @property
    def blocked(self) -> bool:
        return bool(self.blockers)

    @property
    def empty(self) -> bool:
        return not self.actions and not self.blockers

    def groups(self) -> list[tuple[str, list[str]]]:
        """The preview: changes under headings, empty headings left out."""
        groups = [
            (title, [a.label for a in self.actions if a.group == title]) for title in GROUP_ORDER
        ]
        result = [(title, items) for title, items in groups if items]
        if self.gate:
            result.append(("Gate", [GATE_NOTICE]))
        return result


def _event_channel_overwrites(spec: ChannelSpec, staff: list[str]) -> OverwriteSpec:
    return {
        EVERYONE: (0, VIEW_CHANNEL),
        **{event_role_key(e): (VIEW_CHANNEL, 0) for e in spec.event_ids},
        **{k: (STAFF_OVERWRITE, 0) for k in staff},
    }


def _category_overwrites(key: str, staff: list[str]) -> OverwriteSpec:
    """A category's overwrites, which the fixed channels in it share."""
    everyone: OverwriteSpec = {EVERYONE: (0, POSTING)} if key in INFORMATION_KEYS else {}
    return everyone | {k: (staff_allow(key), 0) for k in staff}


def _verify_overwrites(staff: list[str]) -> OverwriteSpec:
    return {
        EVERYONE: (VERIFY_EVERYONE_ALLOW, VERIFY_EVERYONE_DENY),
        VERIFIED_KEY: (0, VIEW_CHANNEL),
        **{k: (STAFF_OVERWRITE, 0) for k in staff},
    }


def _desired_ids(
    spec: OverwriteSpec, roles: dict[str, int | None], everyone: int
) -> dict[int, Overwrite] | None:
    """The overwrites `spec` resolves to now, or None if a role it names isn't created yet."""
    result = {}
    for target, (allow, deny) in spec.items():
        target_id = everyone if target == EVERYONE else roles.get(target)
        if target_id is None:
            if target in roles:
                return None
            continue
        result[target_id] = Overwrite(ROLE_OVERWRITE, allow, deny)
    return result


def overwrites_differ(
    channel: LiveChannel, spec: OverwriteSpec, roles: dict[str, int | None], everyone: int
) -> bool:
    """Whether the channel's overwrites for @everyone and the roles in `roles` (key to id, or
    None while being created) differ from `spec`."""
    desired = _desired_ids(spec, roles, everyone)
    if desired is None:
        return True
    managed = {i for i in roles.values() if i is not None} | {everyone}
    current = {
        target: o
        for target, o in channel.overwrites.items()
        if o.type == ROLE_OVERWRITE and target in managed
    }
    return current != desired


def is_archive_key(key: str) -> bool:
    return chunk_of(key, ARCHIVED_KEY) is not None


def archive_actions(
    snapshot: Snapshot,
    live: Live,
    archive: list[tuple[str, LiveChannel]],
    staff: list[str],
    *,
    create_group: str | None,
    archive_group: str | None,
) -> list[Action]:
    """Moves each channel into the first Archived category with room, making "Archived (2)" and
    on as they fill and remaking any that were deleted."""
    ready = {k for k, i in snapshot.channel_ids.items() if is_archive_key(k) and i in live.channels}
    key_of = {snapshot.channel_ids[k]: k for k in ready}
    load = Counter(key_of[c.parent_id] for c in live.channels.values() if c.parent_id in key_of)
    actions: list[Action] = []
    for key, channel in archive:
        for n in count(1):
            target = chunk_key(ARCHIVED_KEY, n)
            if target not in ready:
                ready.add(target)
                name = chunk_name(ARCHIVED_CATEGORY_NAME, n)
                actions.append(
                    CreateChannel(
                        create_group,
                        f"Category: {name}",
                        target,
                        name,
                        GUILD_CATEGORY,
                        TOP,
                        _category_overwrites(ARCHIVED_KEY, staff),
                    )
                )
            if load[target] < CATEGORY_CAPACITY:
                break
        load[target] += 1
        actions.append(ArchiveChannel(archive_group, f"#{channel.name}", key, channel.id, target))
    return actions


class _Planner:
    def __init__(self, snapshot: Snapshot, live: Live, plan: Plan, *, reset: bool) -> None:
        self.s = snapshot
        self.live = live
        self.plan = plan
        self.reset = reset
        self.first = not snapshot.built
        # Role keys with a Discord id now, or None while their creation is pending.
        self.roles: dict[str, int | None] = {}
        self.tiers: dict[str, str | None] = {}
        self.skipped: set[str] = set()
        self.channels: dict[str, int | None] = {}
        # Channels whose overwrites this plan sets in full, so staff access leaves them alone.
        self.overwritten: set[int] = set()
        self.claimed: set[int] = set()
        # Live managed channels this plan leaves as they are, with their default overwrites.
        self.untouched: list[tuple[LiveChannel, OverwriteSpec]] = []
        self.creates = 0
        self.role_creates = 0

    @property
    def staff_keys(self) -> list[str]:
        return [k for k, t in self.tiers.items() if t == "staff" and k in self.roles]

    def add(self, action: Action) -> None:
        self.plan.actions.append(action)

    def _unmanaged(self, items: list[Any], managed: set[int]) -> dict[str, list[Any]]:
        by_name: dict[str, list[Any]] = {}
        for item in items:
            if item.id not in managed and item.id not in self.claimed:
                by_name.setdefault(item.name, []).append(item)
        return by_name

    def plan_roles(self) -> None:
        managed = set(self.s.role_ids.values())
        candidates = self._unmanaged(
            [r for r in self.live.roles.values() if r.id != self.live.guild_id and not r.managed],
            managed,
        )
        for spec in self.s.layout.roles:
            role_id = self.s.role_ids.get(spec.key)
            live = self.live.roles.get(role_id) if role_id else None
            if live is None:
                matches = [r for r in candidates.get(spec.name, []) if r.id not in self.claimed]
                if len(matches) == 1:
                    live = matches[0]
                    if not self.live.below_bot(live.id):
                        self._skip(spec.key, live.name)
                        continue
                    self.claimed.add(live.id)
                    self.roles[spec.key] = live.id
                    self.tiers[spec.key] = spec.tier
                    self.add(
                        SetUpRole(
                            ADOPT,
                            f"Role: {spec.name}",
                            spec.key,
                            live.id,
                            {"permissions": spec.permissions},
                            spec.tier,
                        )
                    )
                else:
                    self.roles[spec.key] = None
                    self.tiers[spec.key] = spec.tier
                    self.role_creates += 1
                    self.add(CreateRole(CREATE, f"Role: {spec.name}", spec))
                continue

            self.roles[spec.key] = live.id
            if not self.live.below_bot(live.id):
                self._skip(spec.key, live.name)
                self.tiers[spec.key] = self.s.tiers.get(spec.key)
                continue
            if not self.reset:
                self.tiers[spec.key] = self.s.tiers.get(spec.key, spec.tier)
                continue
            self.tiers[spec.key] = spec.tier
            fields: dict[str, Any] = {}
            changes = []
            if live.name != spec.name:
                fields["name"] = spec.name
                changes.append(f"renamed from {live.name}")
            if live.permissions != spec.permissions:
                fields["permissions"] = spec.permissions
                changes.append("permissions")
            if fields or self.s.tiers.get(spec.key) != spec.tier:
                group = UNDO if fields else None
                label = f"{spec.name}: {', '.join(changes)}" if changes else spec.name
                self.add(SetUpRole(group, label, spec.key, live.id, fields, spec.tier))

    def _skip(self, key: str, name: str) -> None:
        self.skipped.add(key)
        self.plan.warnings.append(f"Move lobot's role above {name}.")

    def plan_gate(self) -> None:
        if self.first:
            self.plan.gate = True
        everyone = self.live.everyone
        held = [name for bit, name in EVERYONE_REVOKED.items() if everyone.permissions & bit]
        if (self.first or self.reset) and held:
            self.add(
                SetEveryonePermissions(
                    None if self.first else UNDO,
                    f"@everyone: {', '.join(held)}",
                    everyone.permissions & ~sum(EVERYONE_REVOKED),
                )
            )

    def plan_object(
        self,
        key: str,
        name: str,
        type: int,
        parent: str,
        overwrites: OverwriteSpec,
        *,
        label: str,
        position: int | None = None,
    ) -> None:
        """One category or channel: create it, adopt it, or (on reset) put its defaults back."""
        channel_id = self.s.channel_ids.get(key)
        live = self.live.channels.get(channel_id) if channel_id else None
        if live is None or live.type != type:
            matches = [
                c
                for c in self._unmanaged(
                    list(self.live.channels.values()), set(self.s.channel_ids.values())
                ).get(name, [])
                if c.type == type
            ]
            if len(matches) == 1:
                live = matches[0]
                self.claimed.add(live.id)
                self.channels[key] = live.id
                self.overwritten.add(live.id)
                self.add(SetUpChannel(ADOPT, label, key, live.id, None, parent, overwrites))
            else:
                self.channels[key] = None
                self.creates += 1
                self.add(
                    CreateChannel(CREATE, label, key, name, type, parent, overwrites, position)
                )
            return

        self.channels[key] = live.id
        if not self.reset:
            self.untouched.append((live, overwrites))
            return
        self.reset_object(key, live, name, parent, overwrites, label=label)

    def reset_object(
        self,
        key: str,
        live: LiveChannel,
        name: str,
        parent: str,
        overwrites: OverwriteSpec,
        *,
        label: str,
    ) -> None:
        changes = []
        action = SetUpChannel(UNDO, "", key, live.id)
        if live.name != name:
            action.name = name
            changes.append(f"renamed from {_display(live)}")
        wanted_parent = (
            None if parent == TOP else self.channels.get(parent, self.s.channel_ids.get(parent))
        )
        if (parent != TOP and wanted_parent is None) or live.parent_id != wanted_parent:
            action.parent = parent
            current = self.live.channels.get(live.parent_id) if live.parent_id else None
            changes.append(f"moved from {current.name}" if current else "category")
        if overwrites_differ(live, overwrites, self.roles, self.live.guild_id):
            action.overwrites = overwrites
            self.overwritten.add(live.id)
            changes.insert(0, "overwrites")
        if changes:
            action.label = f"{label}: {', '.join(changes)}"
            self.add(action)

    def plan_categories(self) -> None:
        for spec in self.s.layout.categories:
            self.plan_object(
                spec.key,
                spec.name,
                GUILD_CATEGORY,
                TOP,
                _category_overwrites(spec.key, self.staff_keys),
                label=f"Category: {spec.name}",
            )

    def plan_fixed_channels(self) -> None:
        for spec in self.s.layout.fixed_channels:
            self.plan_object(
                spec.key,
                spec.name,
                GUILD_TEXT,
                spec.category_key,
                _category_overwrites(spec.category_key, self.staff_keys),
                label=f"#{spec.name}",
            )

    def plan_channels(self) -> None:
        for spec in self.s.layout.channels:
            self.plan_object(
                spec.key,
                spec.name,
                GUILD_TEXT,
                spec.category_key,
                _event_channel_overwrites(spec, self.staff_keys),
                label=f"#{spec.name}",
            )

    def plan_verify(self) -> None:
        before = self.s.channel_ids.get(VERIFY_KEY)
        self.plan_object(
            VERIFY_KEY,
            VERIFY_CHANNEL_NAME,
            GUILD_TEXT,
            TOP,
            _verify_overwrites(self.staff_keys),
            label=f"#{VERIFY_CHANNEL_NAME}",
            position=0,
        )
        replaced = self.channels.get(VERIFY_KEY) != before or before is None
        if replaced or not self.live.verify_message_exists:
            self.add(PostVerifyMessage(CREATE, "#verify message"))

    def plan_archive(self) -> None:
        if not self.reset:
            return
        layout_keys = {
            c.key
            for c in (
                *self.s.layout.channels,
                *self.s.layout.categories,
                *self.s.layout.fixed_channels,
            )
        }
        archive = []
        for key, channel_id in self.s.channel_ids.items():
            if key == VERIFY_KEY or is_archive_key(key) or key in layout_keys:
                continue
            live = self.live.channels.get(channel_id)
            if key.startswith("event:") and live is not None:
                archive.append((key, live))
            else:
                self.add(ForgetChannel(None, key, key))
        for action in archive_actions(
            self.s, self.live, archive, self.staff_keys, create_group=CREATE, archive_group=ARCHIVE
        ):
            self.creates += isinstance(action, CreateChannel)
            self.add(action)

    def plan_missing_overwrites(self) -> None:
        """A managed role with no overwrite at all on a managed channel that should have one gets
        it back, as after an admin deletes the role and a build recreates it. Existing
        overwrites are /reset's to change. Staff overwrites are left to plan_staff_access."""
        names = {spec.key: spec.name for spec in self.s.layout.roles}
        staff = set(self.staff_keys)
        for channel, spec in self.untouched:
            for target, (allow, deny) in spec.items():
                if target == EVERYONE or target in staff or target not in self.roles:
                    continue
                role_id = self.roles[target]
                if role_id is None or role_id not in channel.overwrites:
                    self.add(
                        AddOverwrite(
                            CREATE,
                            f"{names.get(target, target)} on {_display(channel)}",
                            channel.id,
                            target,
                            allow,
                            deny,
                        )
                    )

    def plan_staff_access(self) -> None:
        names = {spec.key: spec.name for spec in self.s.layout.roles}
        channel_keys = {v: k for k, v in self.channels.items() if v is not None}
        for channel in self.live.channels.values():
            if channel.id in self.overwritten:
                continue
            for key in self.staff_keys:
                role_id = self.roles.get(key)
                if role_id is None or role_id not in channel.overwrites:
                    self.add(
                        _staff_overwrite(
                            STAFF,
                            f"Add {names.get(key, key)} to {_display(channel)}",
                            channel.id,
                            channel_keys.get(channel.id),
                            key,
                        )
                    )
        if not self.reset:
            return
        for key, old_tier in self.s.tiers.items():
            role_id = self.roles.get(key)
            if old_tier != "staff" or self.tiers.get(key) == "staff" or role_id is None:
                continue
            for channel in self.live.channels.values():
                current = channel.overwrites.get(role_id)
                if channel.id in self.overwritten or current is None:
                    continue
                if current.allow & STAFF_OVERWRITE:
                    self.add(
                        RemoveStaffAllow(
                            STAFF,
                            f"Remove {names.get(key, key)} from {_display(channel)}",
                            channel.id,
                            role_id,
                            current,
                            staff_allow(channel_keys.get(channel.id)),
                        )
                    )

    def plan_order(self) -> None:
        if not (self.first or self.reset):
            return
        role_keys = [spec.key for spec in self.s.layout.roles if spec.key not in self.skipped]
        roles_added = any(isinstance(a, CreateRole) or a.group == ADOPT for a in self.plan.actions)
        roles_moved = self._out_of_order(role_keys, self.roles, self.live.roles, reverse=True)
        if self.first or roles_added or roles_moved:
            group = UNDO if roles_moved and not self.first else None
            self.add(OrderRoles(group, "Role order", role_keys))
            if roles_moved and not self._room_to_order_roles():
                self.plan.warnings.append(
                    "Discord hasn't given this server's roles distinct positions yet, so lobot "
                    "can't put them in order. In Server Settings → Roles, drag any role up or "
                    "down once, then run /reset again."
                )

        category_keys = [c.key for c in self.s.layout.categories]
        channels = [*self.s.layout.fixed_channels, *self.s.layout.channels]
        channel_keys = [c.key for c in channels]
        channels_added = any(
            isinstance(a, CreateChannel | ArchiveChannel)
            or (isinstance(a, SetUpChannel) and a.parent is not None)
            for a in self.plan.actions
        )
        channels_moved = self._out_of_order(
            category_keys, self.channels, self.live.channels
        ) or any(
            self._out_of_order(
                [c.key for c in channels if c.category_key == category],
                self.channels,
                self.live.channels,
            )
            for category in category_keys
        )
        if self.first or channels_added or channels_moved:
            group = UNDO if channels_moved and not self.first else None
            self.add(OrderChannels(group, "Channel order", category_keys, channel_keys))

    def _room_to_order_roles(self) -> bool:
        ranked = self.live.ranked
        bot_index = next((i for i, r in enumerate(ranked) if r.id in self.live.bot_role_ids), None)
        if bot_index is None:
            return False
        below = len(ranked) - bot_index - 1 + self.role_creates
        return ranked[bot_index].position > below

    @staticmethod
    def _out_of_order(
        keys: list[str], ids: dict[str, int | None], live: dict[int, Any], *, reverse: bool = False
    ) -> bool:
        """Whether the live objects for `keys` sit in a different relative order than `keys`.
        Roles count down from the top (`reverse`); channels count up."""
        present = [(k, i) for k in keys if (i := ids.get(k)) is not None and i in live]
        # Equal positions break by id; for roles the lower id ranks higher.
        sign = -1 if reverse else 1
        current = sorted(present, key=lambda pair: (sign * live[pair[1]].position, pair[1]))
        return current != present

    def plan_capacity(self) -> None:
        roles = len(self.live.roles) + self.role_creates
        if roles > MAX_ROLES:
            self.plan.blockers.append(
                f"This would make {roles} roles, over Discord's limit of {MAX_ROLES}. "
                f"Remove {roles - MAX_ROLES} roles from the server first."
            )
        channels = len(self.live.channels) + self.creates
        if channels > MAX_CHANNELS:
            self.plan.blockers.append(
                f"This would make {channels} channels and categories, over Discord's limit of "
                f"{MAX_CHANNELS}. Remove {channels - MAX_CHANNELS} first."
            )


def _display(channel: LiveChannel) -> str:
    return channel.name if channel.type == GUILD_CATEGORY else f"#{channel.name}"


def _require_administrator(live: Live, plan: Plan) -> bool:
    if live.bot_permissions & ADMINISTRATOR:
        return True
    plan.blockers.append(
        "lobot doesn't have the Administrator permission. Give its role Administrator "
        "in Server Settings → Roles, then try again."
    )
    return False


def plan_build(snapshot: Snapshot, live: Live, *, reset: bool) -> Plan:
    plan = Plan()
    if not _require_administrator(live, plan):
        return plan
    snapshot = fit_to_server(snapshot, live, moving=reset)
    planner = _Planner(snapshot, live, plan, reset=reset)
    planner.plan_roles()
    planner.plan_gate()
    planner.plan_categories()
    planner.plan_channels()
    planner.plan_fixed_channels()
    planner.plan_verify()
    planner.plan_archive()
    planner.plan_missing_overwrites()
    planner.plan_staff_access()
    planner.plan_order()
    planner.plan_capacity()
    return plan


@dataclass(frozen=True)
class Target:
    """A scoped /reset's one object: a role, or a channel or category."""

    kind: str
    id: int


NOT_MANAGED = "lobot doesn't manage this."
NEEDS_FULL_RESET = (
    "NEXUS's layout no longer has a place for this channel. Run /reset with no options to apply "
    "the new layout."
)


def plan_scoped_reset(snapshot: Snapshot, live: Live, target: Target) -> Plan:
    plan = Plan()
    if not _require_administrator(live, plan):
        return plan
    snapshot = fit_to_server(snapshot, live, moving=True)
    planner = _Planner(snapshot, live, plan, reset=True)
    for key, role_id in snapshot.role_ids.items():
        if role_id in live.roles:
            planner.roles[key] = role_id
            planner.tiers[key] = snapshot.tiers.get(key)
    for key, channel_id in snapshot.channel_ids.items():
        if channel_id in live.channels:
            planner.channels[key] = channel_id

    if target.kind == "role":
        _plan_role_reset(planner, snapshot, live, target.id)
    else:
        _plan_channel_reset(planner, snapshot, live, target.id)
    return plan


def _plan_role_reset(planner: _Planner, snapshot: Snapshot, live: Live, role_id: int) -> None:
    plan = planner.plan
    key = snapshot.role_key_for(role_id)
    spec = next((r for r in snapshot.layout.roles if r.key == key), None)
    if key is None or role_id not in live.roles:
        plan.blockers.append(NOT_MANAGED)
        return
    if spec is None:
        plan.blockers.append(
            "This role's NEXUS role or event no longer exists. The next sync removes it."
        )
        return
    role = live.roles[role_id]
    if not live.below_bot(role_id):
        plan.blockers.append(f"Move lobot's role above {role.name}.")
        return
    old_tier = snapshot.tiers.get(key)
    planner.tiers[key] = spec.tier
    fields = {"permissions": spec.permissions} if role.permissions != spec.permissions else {}
    if fields or old_tier != spec.tier:
        planner.add(
            SetUpRole(
                UNDO if fields else None,
                f"{spec.name}: permissions" if fields else spec.name,
                key,
                role_id,
                fields,
                spec.tier,
            )
        )
    channel_keys = {v: k for k, v in snapshot.channel_ids.items()}
    for channel in live.channels.values():
        current = channel.overwrites.get(role_id)
        channel_key = channel_keys.get(channel.id)
        allow = staff_allow(channel_key)
        if spec.tier == "staff":
            restore = channel_key is not None and current != Overwrite(ROLE_OVERWRITE, allow, 0)
            if current is None or restore:
                planner.add(
                    _staff_overwrite(
                        STAFF,
                        f"Add {spec.name} to {_display(channel)}",
                        channel.id,
                        channel_key,
                        key,
                    )
                )
        elif old_tier == "staff" and current is not None and current.allow & STAFF_OVERWRITE:
            planner.add(
                RemoveStaffAllow(
                    STAFF,
                    f"Remove {spec.name} from {_display(channel)}",
                    channel.id,
                    role_id,
                    current,
                    allow,
                )
            )


def _plan_channel_reset(planner: _Planner, snapshot: Snapshot, live: Live, channel_id: int) -> None:
    plan = planner.plan
    key = snapshot.channel_key_for(channel_id)
    channel = live.channels.get(channel_id)
    if key is None or is_archive_key(key) or channel is None:
        plan.blockers.append(NOT_MANAGED)
        return
    staff = planner.staff_keys
    if key == VERIFY_KEY:
        planner.reset_object(
            key, channel, VERIFY_CHANNEL_NAME, TOP, _verify_overwrites(staff), label="#verify"
        )
        return
    channels = {c.key: c for c in snapshot.layout.channels}
    fixed = {c.key: c for c in snapshot.layout.fixed_channels}
    categories = {c.key: c for c in snapshot.layout.categories}
    if key in channels:
        _reset_event_channel(planner, channels[key], channel)
        return
    if key in fixed:
        _reset_fixed_channel(planner, fixed[key], channel)
        return
    if key not in categories:
        plan.blockers.append(NEEDS_FULL_RESET)
        return
    category = categories[key]
    planner.reset_object(
        key,
        channel,
        category.name,
        TOP,
        _category_overwrites(key, staff),
        label=f"Category: {category.name}",
    )
    for spec in (*snapshot.layout.channels, *snapshot.layout.fixed_channels):
        child = live.channels.get(snapshot.channel_ids.get(spec.key, 0))
        if child is None or child.parent_id != channel_id:
            continue
        if isinstance(spec, ChannelSpec):
            _reset_event_channel(planner, spec, child)
        else:
            _reset_fixed_channel(planner, spec, child)


def _reset_event_channel(planner: _Planner, spec: ChannelSpec, channel: LiveChannel) -> None:
    if planner.channels.get(spec.category_key) is None:
        planner.plan.blockers.append(NEEDS_FULL_RESET)
        return
    planner.reset_object(
        spec.key,
        channel,
        spec.name,
        spec.category_key,
        _event_channel_overwrites(spec, planner.staff_keys),
        label=f"#{spec.name}",
    )


def _reset_fixed_channel(planner: _Planner, spec: FixedChannelSpec, channel: LiveChannel) -> None:
    if planner.channels.get(spec.category_key) is None:
        planner.plan.blockers.append(NEEDS_FULL_RESET)
        return
    planner.reset_object(
        spec.key,
        channel,
        spec.name,
        spec.category_key,
        _category_overwrites(spec.category_key, planner.staff_keys),
        label=f"#{spec.name}",
    )


# -- Running -----------------------------------------------------------------------------

Progress = Callable[[int, int], Awaitable[None]]
SessionScope = Callable[[], contextlib.AbstractContextManager[Session]]


def default_session_scope() -> Session:
    from app.db.session import SessionLocal

    return SessionLocal()


async def execute(
    plan: Plan,
    snapshot: Snapshot,
    live: Live,
    rest: DiscordRest,
    store: Store,
    progress: Progress | None = None,
    *,
    heartbeat: Callable[[int], None] | None = None,
) -> None:
    """Runs the plan's actions in order, calling `heartbeat` every 30 seconds to keep the
    caller's claim alive, including while an action waits out a rate limit."""
    ctx = Context(
        rest=rest,
        store=store,
        snapshot=snapshot,
        live=live,
        role_ids=dict(snapshot.role_ids),
        channel_ids=dict(snapshot.channel_ids),
    )
    beating = asyncio.create_task(_beat(ctx, heartbeat)) if heartbeat is not None else None
    try:
        total = len(plan.actions)
        for done, action in enumerate(plan.actions, start=1):
            await action.run(ctx)
            if progress is not None:
                await progress(done, total)
    finally:
        if beating is not None:
            beating.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await beating


async def _beat(ctx: Context, heartbeat: Callable[[int], None]) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        await ctx.save(heartbeat)


def build_running(link: DiscordGuildLink) -> bool:
    if link.last_build_status != "running" or link.last_build_at is None:
        return False
    return utcnow() - link.last_build_at < timedelta(minutes=STALE_BUILD_MINUTES)


def _no_build_running(now: datetime) -> ColumnElement[bool]:
    return or_(
        DiscordGuildLink.last_build_status.is_distinct_from("running"),
        DiscordGuildLink.last_build_at < now - timedelta(minutes=STALE_BUILD_MINUTES),
    )


def claim_build(db: Session, link_id: int) -> bool:
    """Marks the link as building unless another build, or the sync's structure step, holds it.
    Builds can run on any backend process, so this is the only thing stopping two at once. Both
    refresh their claim every 30 seconds, so one silent for 2 minutes was interrupted and is
    retaken."""
    now = utcnow()
    claimed = (
        db.query(DiscordGuildLink)
        .filter(
            DiscordGuildLink.id == link_id,
            _no_build_running(now),
            or_(
                DiscordGuildLink.sync_started_at.is_(None),
                DiscordGuildLink.sync_started_at < now - timedelta(minutes=STALE_BUILD_MINUTES),
            ),
        )
        .update(
            {"last_build_status": "running", "last_build_at": now, "last_build_error": None},
            synchronize_session=False,
        )
    )
    db.commit()
    return claimed == 1


def claim_sync(db: Session, link_id: int) -> bool:
    """Lets the sync change roles and channels unless a build holds the link. Without it, a build
    and the sync could plan from the same snapshot and both create a missing role."""
    now = utcnow()
    claimed = (
        db.query(DiscordGuildLink)
        .filter(DiscordGuildLink.id == link_id, _no_build_running(now))
        .update({"sync_started_at": now}, synchronize_session=False)
    )
    db.commit()
    return claimed == 1


def release_sync(db: Session, link_id: int) -> None:
    db.query(DiscordGuildLink).filter(DiscordGuildLink.id == link_id).update(
        {"sync_started_at": None}, synchronize_session=False
    )
    db.commit()


def finish_build(db: Session, link_id: int, error: str | None) -> None:
    link = db.get(DiscordGuildLink, link_id)
    if link is None:
        return
    link.last_build_at = utcnow()
    link.last_build_status = "failed" if error else "succeeded"
    link.last_build_error = error[:2000] if error else None
    if error is None:
        link.built_at = link.built_at or utcnow()
        # Verifies everyone already in the server.
        mark_full(db, link_id)
    db.commit()


async def prepare(
    link_id: int, *, reset: bool, target: Target | None, session_scope: SessionScope
) -> tuple[Plan, Snapshot, Live]:
    """Reads both sides and plans. This is the preview, and the first half of a real run."""

    def load() -> Snapshot:
        with session_scope() as db:
            return load_snapshot(db, link_id)

    snapshot = await asyncio.to_thread(load)
    live = await fetch_live(discord_rest.get_rest(), snapshot)
    if target is not None:
        plan = plan_scoped_reset(snapshot, live, target)
    else:
        plan = plan_build(snapshot, live, reset=reset)
    return plan, snapshot, live


async def run_build(
    link_id: int,
    *,
    reset: bool,
    target: Target | None,
    session_scope: SessionScope,
    progress: Progress | None = None,
) -> str | None:
    """Runs a build the caller already claimed, and records how it ended. Returns the error, if
    it failed."""
    error = None
    try:
        plan, snapshot, live = await prepare(
            link_id, reset=reset, target=target, session_scope=session_scope
        )
        if plan.blocked:
            error = " ".join(plan.blockers)
        else:
            store = Store(session_scope)
            await execute(
                plan,
                snapshot,
                live,
                discord_rest.get_rest(),
                store,
                progress,
                heartbeat=store.heartbeat,
            )
    except Exception as exc:
        log.exception("Discord build for link %s failed", link_id)
        error = str(exc) or type(exc).__name__

    def finish() -> None:
        with session_scope() as db:
            finish_build(db, link_id, error)

    await asyncio.to_thread(finish)
    return error
