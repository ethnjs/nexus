"""Keeping a built server in step with NEXUS between builds: who holds which managed roles, and
that managed roles and channels exist. Never how they're configured (permissions, tiers,
overwrites, names of channels, the layout, order); that's /reset.

A structure reconcile plans with the build's actions (build.py) but matches channels by the
events they cover rather than by the layout's keys, so a layout change waits for /reset: an
event joining a merged channel's group joins that channel, an event that leaves a channel
shrinks its key, and only events no managed channel covers get a new one.
"""

from dataclasses import dataclass

from app.core.discord.build import (
    ARCHIVED_CATEGORY_NAME,
    ARCHIVED_KEY,
    TOP,
    VERIFY_CHANNEL_NAME,
    VERIFY_KEY,
    Action,
    AddOverwrite,
    ArchiveChannel,
    Context,
    CreateChannel,
    CreateRole,
    ForgetChannel,
    Live,
    Plan,
    PostVerifyMessage,
    SetUpChannel,
    SetUpRole,
    Snapshot,
    _category_overwrites,
    _event_channel_overwrites,
    _staff_overwrite,
    _verify_overwrites,
    parse_roles,
)
from app.core.discord.layout import VERIFIED_KEY, ChannelSpec, channel_key, event_role_key
from app.services.discord.permissions import VIEW_CHANNEL
from app.services.discord.rest import GUILD_CATEGORY, GUILD_TEXT, DiscordRest

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
        self.archive_ready = False

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
                self.roles[spec.key] = None
                self.tiers[spec.key] = spec.tier
                self.add(CreateRole(None, f"Role: {spec.name}", spec))
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

    def ensure_category(self, key: str) -> None:
        if key in self.ready_categories:
            return
        self.ready_categories.add(key)
        if self.live_channel(key) is not None:
            return
        spec = next(c for c in self.s.layout.categories if c.key == key)
        if key in self.s.channel_ids:
            self.recreated_categories.add(key)
        self.add(
            CreateChannel(
                None,
                f"Category: {spec.name}",
                key,
                spec.name,
                GUILD_CATEGORY,
                TOP,
                _category_overwrites(self.staff_keys),
            )
        )

    def ensure_archive(self) -> None:
        if self.archive_ready:
            return
        self.archive_ready = True
        if self.live_channel(ARCHIVED_KEY) is None:
            self.add(
                CreateChannel(
                    None,
                    f"Category: {ARCHIVED_CATEGORY_NAME}",
                    ARCHIVED_KEY,
                    ARCHIVED_CATEGORY_NAME,
                    GUILD_CATEGORY,
                    TOP,
                    _category_overwrites(self.staff_keys),
                )
            )

    def channels_step(self) -> None:
        layout = self.s.layout
        on_track = {e for spec in layout.channels for e in spec.event_ids}
        spec_of = {e: spec for spec in layout.channels for e in spec.event_ids}
        category_keys = {c.key for c in layout.categories}

        # Events each managed event channel still covers.
        covers: dict[str, set[int]] = {}
        covered_by: dict[int, str] = {}
        for key, channel_id in self.s.channel_ids.items():
            if not key.startswith("event:"):
                continue
            surviving = {int(e) for e in key.removeprefix("event:").split(",")} & on_track
            if surviving:
                covers[key] = surviving
                covered_by.update(dict.fromkeys(surviving, key))
            elif channel_id in self.live.channels:
                self.ensure_archive()
                name = self.live.channels[channel_id].name
                self.add(ArchiveChannel(None, f"#{name}", key, channel_id))
            else:
                self.add(ForgetChannel(None, key, key))

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
            if key.startswith("event:") or key in (VERIFY_KEY, ARCHIVED_KEY):
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

    def _create_event_channel(self, spec: ChannelSpec) -> None:
        self.add(
            CreateChannel(
                None,
                f"#{spec.name}",
                spec.key,
                spec.name,
                GUILD_TEXT,
                spec.category_key,
                _event_channel_overwrites(spec, self.staff_keys),
            )
        )

    def verify_step(self) -> None:
        channel_id = self.live_channel(VERIFY_KEY)
        if channel_id is None:
            self.add(
                CreateChannel(
                    None,
                    f"#{VERIFY_CHANNEL_NAME}",
                    VERIFY_KEY,
                    VERIFY_CHANNEL_NAME,
                    GUILD_TEXT,
                    TOP,
                    _verify_overwrites(self.staff_keys),
                    position=0,
                )
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
        for channel in self.live.channels.values():
            for key in self.staff_keys:
                role_id = self.roles[key]
                if role_id is None or role_id not in channel.overwrites:
                    self.add(_staff_overwrite(None, f"Staff on {channel.name}", channel.id, key))


def plan_structure(snapshot: Snapshot, live: Live) -> tuple[Plan, set[str]]:
    """The structure reconcile's actions, and the names of managed roles above the bot."""
    planner = _SyncPlanner(snapshot, live)
    planner.roles_step()
    planner.channels_step()
    planner.verify_step()
    planner.staff_step()
    return planner.plan, planner.above_bot


async def fetch_roles(rest: DiscordRest, snapshot: Snapshot) -> Live:
    """The roles half of the live state, all a member reconcile needs."""
    roles = parse_roles((await rest.guild(snapshot.guild_id))["roles"])
    me = await rest.member(snapshot.guild_id, await rest.me())
    bot_roles = {int(r) for r in (me or {}).get("roles", []) if int(r) in roles}
    return Live(
        guild_id=snapshot.guild_id,
        roles=roles,
        channels={},
        bot_role_ids=bot_roles,
        bot_permissions=0,
        verify_message_exists=False,
    )


async def apply_member_roles(
    rest: DiscordRest,
    snapshot: Snapshot,
    live: Live,
    member: dict,
    keys: set[str],
    above_bot: set[str],
) -> None:
    """Gives one member the managed roles in `keys` and takes away every other managed role,
    one role per call so roles NEXUS doesn't manage are never touched. Bots are left alone, and
    roles above the bot are skipped and added to `above_bot`."""
    if member["user"].get("bot"):
        return
    user_id = int(member["user"]["id"])
    managed = {role_id for role_id in snapshot.role_ids.values() if role_id in live.roles}
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


async def all_members(rest: DiscordRest, guild_id: int) -> list[dict]:
    members: list[dict] = []
    after = 0
    while True:
        page = await rest.members(guild_id, after=after, limit=MEMBERS_PAGE)
        members.extend(page)
        if len(page) < MEMBERS_PAGE:
            return members
        after = int(page[-1]["user"]["id"])
