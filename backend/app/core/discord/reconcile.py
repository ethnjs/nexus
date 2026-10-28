"""Keeping a built server in step with NEXUS between builds: who holds which managed roles,
members' nicknames, and that managed roles and channels exist, the fixed channels included. Never
how they're configured (permissions, tiers, overwrites, names of channels, the layout, order);
that's /reset. So unlike the build, the sync adopts only objects already configured as it would
create them.

A structure reconcile plans with the build's actions (build.py) but matches channels by the
events they cover rather than by the layout's keys, so a layout change waits for /reset: an
event joining a merged channel's group joins that channel, an event that leaves a channel
shrinks its key, and only events no managed channel covers get a new one.
"""

import logging
from dataclasses import dataclass

from app.core.discord.build import (
    TOP,
    VERIFY_CHANNEL_NAME,
    VERIFY_KEY,
    Action,
    AddOverwrite,
    Context,
    CreateChannel,
    CreateRole,
    ForgetChannel,
    Live,
    LiveChannel,
    LiveRole,
    OverwriteSpec,
    Plan,
    PostVerifyMessage,
    SetUpChannel,
    SetUpRole,
    Snapshot,
    _category_overwrites,
    _event_channel_overwrites,
    _staff_overwrite,
    _verify_overwrites,
    archive_actions,
    fit_to_server,
    is_archive_key,
    overwrites_differ,
    parse_roles,
)
from app.core.discord.eligibility import DesiredMember
from app.core.discord.layout import (
    FIXED_CHANNEL_KEYS,
    VERIFIED_KEY,
    ChannelSpec,
    RoleSpec,
    channel_key,
    event_role_key,
)
from app.services.discord.permissions import VIEW_CHANNEL
from app.services.discord.rest import GUILD_CATEGORY, GUILD_TEXT, DiscordRest

log = logging.getLogger(__name__)

MEMBERS_PAGE = 1000


def above_bot_message(names: set[str]) -> str | None:
    """The sync status for roles the bot can't manage, or None if there are none."""
    if not names:
        return None
    listed = ", ".join(sorted(names))
    pronoun = "it" if len(names) == 1 else "them"
    return f"Move lobot's role above {listed}. lobot can't give or remove {pronoun}."


@dataclass
class DeleteRole(Action):
    key: str
    role_id: int

    async def run(self, ctx: Context) -> None:
        await ctx.rest.delete_role(ctx.guild_id, self.role_id)
        ctx.role_ids.pop(self.key, None)
        await ctx.save(ctx.store.forget_role, self.key)


@dataclass
class ForgetRole(Action):
    key: str

    async def run(self, ctx: Context) -> None:
        ctx.role_ids.pop(self.key, None)
        await ctx.save(ctx.store.forget_role, self.key)


@dataclass
class RekeyChannel(Action):
    old_key: str
    new_key: str

    async def run(self, ctx: Context) -> None:
        channel_id = ctx.channel_ids.pop(self.old_key)
        ctx.channel_ids[self.new_key] = channel_id
        await ctx.save(ctx.store.rekey_channel, self.old_key, self.new_key)


class _SyncPlanner:
    def __init__(self, snapshot: Snapshot, live: Live) -> None:
        self.s = snapshot
        self.live = live
        self.plan = Plan()
        self.above_bot: set[str] = set()
        # Role keys with an id now, or None while their creation is pending.
        self.roles: dict[str, int | None] = {}
        self.tiers = dict(snapshot.tiers)
        self.ready_categories: set[str] = set()
        self.recreated_categories: set[str] = set()
        self.claimed: set[int] = set()
        # Channel keys this plan adopts, with the adopted ids.
        self.adopted: dict[str, int] = {}

    def add(self, action: Action) -> None:
        self.plan.actions.append(action)

    @property
    def staff_keys(self) -> list[str]:
        return [k for k in self.roles if self.tiers.get(k) == "staff"]

    def live_channel(self, key: str) -> int | None:
        channel_id = self.s.channel_ids.get(key)
        return channel_id if channel_id in self.live.channels else None

    def roles_step(self) -> None:
        layout_keys = set()
        for spec in self.s.layout.roles:
            layout_keys.add(spec.key)
            role_id = self.s.role_ids.get(spec.key)
            role = self.live.roles.get(role_id) if role_id else None
            if role is None:
                self.tiers[spec.key] = spec.tier
                adoptable = self._adoptable_role(spec)
                if adoptable is None:
                    self.roles[spec.key] = None
                    self.add(CreateRole(None, f"Role: {spec.name}", spec))
                else:
                    self.roles[spec.key] = adoptable.id
                    self.add(
                        SetUpRole(None, f"Role: {spec.name}", spec.key, adoptable.id, {}, spec.tier)
                    )
                continue
            self.roles[spec.key] = role.id
            if role.name != spec.name:
                if self.live.below_bot(role.id):
                    self.add(
                        SetUpRole(
                            None,
                            f"{spec.name}: renamed from {role.name}",
                            spec.key,
                            role.id,
                            {"name": spec.name},
                            self.tiers.get(spec.key),
                        )
                    )
                else:
                    self.above_bot.add(role.name)
        for key, role_id in self.s.role_ids.items():
            if key in layout_keys:
                continue
            role = self.live.roles.get(role_id)
            if role is None:
                self.add(ForgetRole(None, key, key))
            elif self.live.below_bot(role_id):
                self.add(DeleteRole(None, f"Delete role {role.name}", key, role_id))
            else:
                self.above_bot.add(role.name)

    def _adoptable_role(self, spec: RoleSpec) -> LiveRole | None:
        """The one unmanaged role named like `spec`, if it already has the permissions a create
        would give it. Adopting changes nothing, so the sync still never changes configuration."""
        managed = set(self.s.role_ids.values()) | self.claimed | {self.live.guild_id}
        matches = [
            r
            for r in self.live.roles.values()
            if r.name == spec.name and r.id not in managed and not r.managed
        ]
        if len(matches) != 1:
            return None
        [role] = matches
        if role.permissions != spec.permissions or not self.live.below_bot(role.id):
            return None
        self.claimed.add(role.id)
        return role

    def create_channel(
        self,
        label: str,
        key: str,
        name: str,
        type: int,
        parent: str,
        overwrites: OverwriteSpec,
        position: int | None = None,
    ) -> None:
        """Creates a missing managed channel or category, or adopts the one unmanaged channel with
        its name if that's already set up as the create would set it up, as one is when a create
        timed out after Discord made it."""
        channel = self._adoptable_channel(name, type, parent, overwrites)
        if channel is None:
            self.add(CreateChannel(None, label, key, name, type, parent, overwrites, position))
            return
        self.claimed.add(channel.id)
        self.adopted[key] = channel.id
        self.add(SetUpChannel(None, label, key, channel.id))

    def _adoptable_channel(
        self, name: str, type: int, parent: str, overwrites: OverwriteSpec
    ) -> LiveChannel | None:
        managed = set(self.s.channel_ids.values()) | self.claimed
        matches = [
            c
            for c in self.live.channels.values()
            if c.name == name and c.type == type and c.id not in managed
        ]
        if len(matches) != 1:
            return None
        [channel] = matches
        parent_id = None if parent == TOP else self.adopted.get(parent, self.live_channel(parent))
        if parent != TOP and parent_id is None:
            return None
        if channel.parent_id != parent_id:
            return None
        if overwrites_differ(channel, overwrites, self.roles, self.live.guild_id):
            return None
        return channel

    def ensure_category(self, key: str) -> None:
        if key in self.ready_categories:
            return
        self.ready_categories.add(key)
        if self.live_channel(key) is not None:
            return
        spec = next(c for c in self.s.layout.categories if c.key == key)
        if key in self.s.channel_ids:
            self.recreated_categories.add(key)
        self.create_channel(
            f"Category: {spec.name}",
            key,
            spec.name,
            GUILD_CATEGORY,
            TOP,
            _category_overwrites(key, self.staff_keys),
        )

    def channels_step(self) -> None:
        layout = self.s.layout
        on_track = {e for spec in layout.channels for e in spec.event_ids}
        spec_of = {e: spec for spec in layout.channels for e in spec.event_ids}
        category_keys = {c.key for c in layout.categories}

        # Events each managed event channel still covers.
        covers: dict[str, set[int]] = {}
        covered_by: dict[int, str] = {}
        archive = []
        for key, channel_id in self.s.channel_ids.items():
            if not key.startswith("event:"):
                continue
            surviving = {int(e) for e in key.removeprefix("event:").split(",")} & on_track
            if surviving:
                covers[key] = surviving
                covered_by.update(dict.fromkeys(surviving, key))
            elif channel_id in self.live.channels:
                archive.append((key, self.live.channels[channel_id]))
            else:
                self.add(ForgetChannel(None, key, key))
        for action in archive_actions(
            self.s, self.live, archive, self.staff_keys, create_group=None, archive_group=None
        ):
            if isinstance(action, CreateChannel):
                self.create_channel(
                    action.label,
                    action.key,
                    action.name,
                    action.type,
                    action.parent,
                    action.overwrites,
                )
            else:
                self.add(action)

        new_specs = []
        for spec in layout.channels:
            uncovered = {e for e in spec.event_ids if e not in covered_by}
            if not uncovered:
                continue
            joined = next((covered_by[e] for e in spec.event_ids if e in covered_by), None)
            if joined is None:
                new_specs.append(spec)
                continue
            covers[joined] |= uncovered
            covered_by.update(dict.fromkeys(uncovered, joined))

        for key, channel_id in self.s.channel_ids.items():
            if key.startswith("event:") or key in (VERIFY_KEY, *FIXED_CHANNEL_KEYS):
                continue
            # A deleted Archived category is remade when something next needs it.
            if is_archive_key(key):
                continue
            if channel_id not in self.live.channels:
                if key in category_keys:
                    self.ensure_category(key)
                else:
                    self.add(ForgetChannel(None, key, key))

        for key, events in covers.items():
            spec = spec_of[min(events)]
            new_key = channel_key(events)
            channel_id = self.live_channel(key)
            if channel_id is None:
                self.ensure_category(spec.category_key)
                if new_key != key:
                    self.add(ForgetChannel(None, key, key))
                self._create_event_channel(
                    ChannelSpec(new_key, spec.name, spec.category_key, tuple(sorted(events)))
                )
                continue
            channel = self.live.channels[channel_id]
            if new_key != key:
                self.add(RekeyChannel(None, f"#{channel.name}", key, new_key))
            if channel.parent_id is None and spec.category_key in self.recreated_categories:
                self.add(
                    SetUpChannel(
                        None, f"#{channel.name}", new_key, channel_id, parent=spec.category_key
                    )
                )
            for event_id in sorted(events):
                role_key = event_role_key(event_id)
                if role_key not in self.roles:
                    continue
                role_id = self.roles[role_key]
                if role_id is None or role_id not in channel.overwrites:
                    self.add(
                        AddOverwrite(None, f"#{channel.name}", channel_id, role_key, VIEW_CHANNEL)
                    )

        for spec in new_specs:
            self.ensure_category(spec.category_key)
            self._create_event_channel(spec)

    def fixed_step(self) -> None:
        for spec in self.s.layout.fixed_channels:
            channel_id = self.live_channel(spec.key)
            if channel_id is None:
                self.ensure_category(spec.category_key)
                self.create_channel(
                    f"#{spec.name}",
                    spec.key,
                    spec.name,
                    GUILD_TEXT,
                    spec.category_key,
                    _category_overwrites(spec.category_key, self.staff_keys),
                )
                continue
            channel = self.live.channels[channel_id]
            if channel.parent_id is None and spec.category_key in self.recreated_categories:
                self.add(
                    SetUpChannel(
                        None, f"#{channel.name}", spec.key, channel_id, parent=spec.category_key
                    )
                )

    def _create_event_channel(self, spec: ChannelSpec) -> None:
        self.create_channel(
            f"#{spec.name}",
            spec.key,
            spec.name,
            GUILD_TEXT,
            spec.category_key,
            _event_channel_overwrites(spec, self.staff_keys),
        )

    def verify_step(self) -> None:
        channel_id = self.live_channel(VERIFY_KEY)
        if channel_id is None:
            self.create_channel(
                f"#{VERIFY_CHANNEL_NAME}",
                VERIFY_KEY,
                VERIFY_CHANNEL_NAME,
                GUILD_TEXT,
                TOP,
                _verify_overwrites(self.staff_keys),
                position=0,
            )
            self.add(PostVerifyMessage(None, "#verify message"))
            return
        if not self.live.verify_message_exists:
            self.add(PostVerifyMessage(None, "#verify message"))
        verified = self.roles.get(VERIFIED_KEY)
        if VERIFIED_KEY in self.roles and (
            verified is None or verified not in self.live.channels[channel_id].overwrites
        ):
            self.add(AddOverwrite(None, "#verify", channel_id, VERIFIED_KEY, 0, VIEW_CHANNEL))

    def staff_step(self) -> None:
        channel_keys = {v: k for k, v in self.s.channel_ids.items()}
        for channel in self.live.channels.values():
            for key in self.staff_keys:
                role_id = self.roles[key]
                if role_id is None or role_id not in channel.overwrites:
                    label = f"Staff on {channel.name}"
                    channel_key = channel_keys.get(channel.id)
                    self.add(_staff_overwrite(None, label, channel.id, channel_key, key))


def plan_structure(snapshot: Snapshot, live: Live) -> tuple[Plan, set[str]]:
    """The structure reconcile's actions, and the names of managed roles above the bot."""
    planner = _SyncPlanner(fit_to_server(snapshot, live, moving=False), live)
    planner.roles_step()
    planner.channels_step()
    planner.fixed_step()
    planner.verify_step()
    planner.staff_step()
    return planner.plan, planner.above_bot


async def fetch_roles(rest: DiscordRest, snapshot: Snapshot) -> Live:
    """The roles half of the live state, all a member reconcile needs."""
    guild = await rest.guild(snapshot.guild_id)
    roles = parse_roles(guild["roles"])
    me = await rest.member(snapshot.guild_id, await rest.me())
    bot_roles = {int(r) for r in (me or {}).get("roles", []) if int(r) in roles}
    return Live(
        guild_id=snapshot.guild_id,
        owner_id=int(guild["owner_id"]),
        roles=roles,
        channels={},
        bot_role_ids=bot_roles,
        bot_permissions=0,
        verify_message_exists=False,
    )


async def apply_member(
    rest: DiscordRest,
    snapshot: Snapshot,
    live: Live,
    member: dict,
    desired: DesiredMember | None,
    above_bot: set[str],
) -> None:
    """Gives one member the managed roles and nickname in `desired`, or none of the managed roles
    if None, and takes away every other managed role, one role per call so roles NEXUS doesn't
    manage are never touched. Bots are left alone, and roles above the bot are skipped and added
    to `above_bot`."""
    if member["user"].get("bot"):
        return
    user_id = int(member["user"]["id"])
    managed = {role_id for role_id in snapshot.role_ids.values() if role_id in live.roles}
    keys = desired.role_keys if desired else set()
    wanted = {snapshot.role_ids[k] for k in keys if snapshot.role_ids.get(k) in managed}
    held = {int(r) for r in member["roles"]}
    for role_id in sorted(wanted - held):
        if live.below_bot(role_id):
            await rest.add_member_role(snapshot.guild_id, user_id, role_id)
        else:
            above_bot.add(live.roles[role_id].name)
    for role_id in sorted((held & managed) - wanted):
        if live.below_bot(role_id):
            await rest.remove_member_role(snapshot.guild_id, user_id, role_id)
        else:
            above_bot.add(live.roles[role_id].name)
    nick = desired.nick if desired else None
    # Discord lets no bot rename the server owner, or anyone holding a role at or above its own.
    renamable = user_id != live.owner_id and all(live.below_bot(r) for r in held if r in live.roles)
    if nick is not None and member.get("nick") != nick and renamable:
        # A name Discord refuses mustn't fail the sync for everyone else in the server.
        if not await rest.edit_member_nick(snapshot.guild_id, user_id, nick):
            log.warning("Discord refused the nickname for %s in server %s", user_id, live.guild_id)


async def all_members(rest: DiscordRest, guild_id: int) -> list[dict]:
    members: list[dict] = []
    after = 0
    while True:
        page = await rest.members(guild_id, after=after, limit=MEMBERS_PAGE)
        members.extend(page)
        if len(page) < MEMBERS_PAGE:
            return members
        after = int(page[-1]["user"]["id"])
