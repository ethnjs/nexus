"""An in-memory Discord server with DiscordRest's interface. The autouse `mock_discord_rest`
fixture installs it, so no test reaches Discord. Data is shaped like Discord's JSON, ids as
strings included, because the code under test parses it the same way."""

import itertools
from typing import Any

from app.services.discord.permissions import ADMINISTRATOR, CHANGE_NICKNAME, VIEW_CHANNEL
from app.services.discord.rest import GUILD_CATEGORY, GUILD_TEXT

BOT_USER_ID = 900


class FakeGuild:
    def __init__(self, guild_id: int, owner_id: int, ids: itertools.count) -> None:
        self.id = guild_id
        self.owner_id = owner_id
        self._ids = ids
        self.roles: dict[int, dict[str, Any]] = {
            guild_id: {
                "id": str(guild_id),
                "name": "@everyone",
                "permissions": str(VIEW_CHANNEL | 1 << 11 | CHANGE_NICKNAME),
                "position": 0,
                "managed": False,
            }
        }
        self.channels: dict[int, dict[str, Any]] = {}
        self.members: dict[int, list[int]] = {}
        self.nicks: dict[int, str | None] = {}
        # Nicknames Discord answers with 400, as AutoMod's member-profile rule does.
        self.refused_nicks: set[str] = set()
        self.bots: set[int] = {BOT_USER_ID}
        # Like a new server that Discord never gave distinct role positions: every role sits at
        # position 1 and creates don't shift anything.
        self.tied_positions = False
        self.bot_role = self.add_role("NEXUS", ADMINISTRATOR, managed=True, top=True)
        self.members[BOT_USER_ID] = [self.bot_role]

    def next_id(self) -> int:
        return next(self._ids)

    def add_role(
        self, name: str, permissions: int = 0, *, managed: bool = False, top: bool = False
    ) -> int:
        """Adds a role at the bottom, where Discord puts new roles, or at the top, as if an admin
        dragged it above everything (the bot included)."""
        role_id = self.next_id()
        if top:
            position = max(int(r["position"]) for r in self.roles.values()) + 1
        else:
            position = 1
            for role in self.roles.values():
                if int(role["position"]) >= 1:
                    role["position"] = int(role["position"]) + 1
        self.roles[role_id] = {
            "id": str(role_id),
            "name": name,
            "permissions": str(permissions),
            "position": position,
            "managed": managed,
        }
        return role_id

    def add_channel(
        self,
        name: str,
        type: int = GUILD_TEXT,
        parent_id: int | None = None,
        overwrites: list[dict[str, Any]] | None = None,
    ) -> int:
        channel_id = self.next_id()
        self.channels[channel_id] = {
            "id": str(channel_id),
            "type": type,
            "name": name,
            "parent_id": str(parent_id) if parent_id else None,
            "position": len(self.channels),
            "permission_overwrites": overwrites or [],
        }
        return channel_id

    def join(
        self, user_id: int, *role_ids: int, bot: bool = False, nick: str | None = None
    ) -> None:
        self.members[user_id] = list(role_ids)
        self.nicks[user_id] = nick
        if bot:
            self.bots.add(user_id)

    def member_role_names(self, user_id: int) -> set[str]:
        return {self.roles[r]["name"] for r in self.members[user_id] if r in self.roles}

    def role(self, name: str) -> dict[str, Any]:
        [role] = [r for r in self.roles.values() if r["name"] == name]
        return role

    def channel(self, name: str, type: int | None = None) -> dict[str, Any]:
        matches = [
            c for c in self.channels.values() if c["name"] == name and type in (None, c["type"])
        ]
        assert len(matches) == 1, f"{len(matches)} channels named {name}"
        return matches[0]

    def overwrite(self, channel: dict[str, Any], target_id: int) -> tuple[int, int] | None:
        for o in channel["permission_overwrites"]:
            if int(o["id"]) == target_id:
                return int(o["allow"]), int(o["deny"])
        return None

    def roles_top_down(self) -> list[str]:
        return [r["name"] for r in sorted(self.roles.values(), key=lambda r: -int(r["position"]))]

    def category_names(self) -> list[str]:
        cats = [c for c in self.channels.values() if c["type"] == GUILD_CATEGORY]
        return [c["name"] for c in sorted(cats, key=lambda c: (c["position"], int(c["id"])))]

    def children(self, category: dict[str, Any] | None) -> list[str]:
        parent = category["id"] if category else None
        items = [
            c
            for c in self.channels.values()
            if c["parent_id"] == parent and c["type"] != GUILD_CATEGORY
        ]
        return [c["name"] for c in sorted(items, key=lambda c: (c["position"], int(c["id"])))]


def _member_json(guild: FakeGuild, user_id: int) -> dict[str, Any]:
    user: dict[str, Any] = {"id": str(user_id)}
    if user_id in guild.bots:
        user["bot"] = True
    return {
        "user": user,
        "roles": [str(r) for r in guild.members[user_id]],
        "nick": guild.nicks.get(user_id),
    }


def _require_below_bot(guild: FakeGuild, role_id: int) -> None:
    """Discord: "403 Forbidden (error code: 50013): Missing Permissions"."""
    bot = guild.roles[guild.bot_role]
    role = guild.roles[role_id]
    if (int(role["position"]), -int(role["id"])) >= (int(bot["position"]), -int(bot["id"])):
        raise RuntimeError("Missing Permissions")


class FakeDiscord:
    def __init__(self) -> None:
        self._ids = itertools.count(10_000)
        self.guilds: dict[int, FakeGuild] = {}
        self.messages: dict[int, dict[int, dict[str, Any]]] = {}
        self.writes: list[tuple[str, Any]] = []
        self.interaction_replies: list[tuple[str, dict[str, Any]]] = []
        self.left: list[int] = []
        self.bot_user_id = BOT_USER_ID

    def add_guild(self, guild_id: int, owner_id: int = 1) -> FakeGuild:
        guild = FakeGuild(guild_id, owner_id, self._ids)
        self.guilds[guild_id] = guild
        return guild

    def _guild_of(self, channel_id: int) -> FakeGuild:
        for guild in self.guilds.values():
            if channel_id in guild.channels:
                return guild
        raise AssertionError(f"unknown channel {channel_id}")

    def _write(self, kind: str, detail: Any) -> None:
        self.writes.append((kind, detail))

    async def me(self) -> int:
        return BOT_USER_ID

    async def guild(self, guild_id: int) -> dict[str, Any]:
        guild = self.guilds[guild_id]
        return {
            "id": str(guild_id),
            "owner_id": str(guild.owner_id),
            "roles": [dict(r) for r in guild.roles.values()],
        }

    async def channels(self, guild_id: int) -> list[dict[str, Any]]:
        return [
            {**c, "permission_overwrites": [dict(o) for o in c["permission_overwrites"]]}
            for c in self.guilds[guild_id].channels.values()
        ]

    async def member(self, guild_id: int, user_id: int) -> dict[str, Any] | None:
        guild = self.guilds[guild_id]
        if user_id not in guild.members:
            return None
        return _member_json(guild, user_id)

    async def members(
        self, guild_id: int, *, after: int = 0, limit: int = 1000
    ) -> list[dict[str, Any]]:
        guild = self.guilds[guild_id]
        ids = sorted(i for i in guild.members if i > after)[:limit]
        self._write("list_members", after)
        return [_member_json(guild, i) for i in ids]

    async def add_member_role(self, guild_id: int, user_id: int, role_id: int) -> None:
        guild = self.guilds[guild_id]
        _require_below_bot(guild, role_id)
        if role_id not in guild.members[user_id]:
            guild.members[user_id].append(role_id)
        self._write("add_member_role", (user_id, guild.roles[role_id]["name"]))

    async def remove_member_role(self, guild_id: int, user_id: int, role_id: int) -> None:
        guild = self.guilds[guild_id]
        _require_below_bot(guild, role_id)
        if role_id in guild.members.get(user_id, []):
            guild.members[user_id].remove(role_id)
        self._write("remove_member_role", (user_id, guild.roles[role_id]["name"]))

    async def edit_member_nick(self, guild_id: int, user_id: int, nick: str) -> bool:
        guild = self.guilds[guild_id]
        if user_id == guild.owner_id:
            raise RuntimeError("Missing Permissions")
        for role_id in guild.members[user_id]:
            _require_below_bot(guild, role_id)
        if nick in guild.refused_nicks:
            return False
        guild.nicks[user_id] = nick
        self._write("edit_member_nick", (user_id, nick))
        return True

    async def leave_guild(self, guild_id: int) -> None:
        self.left.append(guild_id)
        self._write("leave_guild", guild_id)

    async def delete_role(self, guild_id: int, role_id: int) -> None:
        guild = self.guilds[guild_id]
        role = guild.roles.pop(role_id, None)
        for roles in guild.members.values():
            if role_id in roles:
                roles.remove(role_id)
        for channel in guild.channels.values():
            channel["permission_overwrites"] = [
                o for o in channel["permission_overwrites"] if int(o["id"]) != role_id
            ]
        self._write("delete_role", role["name"] if role else role_id)

    async def create_role(
        self, guild_id: int, *, name: str, permissions: int, hoist: bool = False
    ) -> dict[str, Any]:
        guild = self.guilds[guild_id]
        for role in guild.roles.values():
            if int(role["position"]) >= 1 and not guild.tied_positions:
                role["position"] = int(role["position"]) + 1
        role_id = guild.next_id()
        guild.roles[role_id] = {
            "id": str(role_id),
            "name": name,
            "permissions": str(permissions),
            "position": 1,
            "managed": False,
            "hoist": hoist,
        }
        self._write("create_role", name)
        return dict(guild.roles[role_id])

    async def edit_role(self, guild_id: int, role_id: int, **fields: Any) -> dict[str, Any]:
        role = self.guilds[guild_id].roles[role_id]
        if "permissions" in fields:
            fields["permissions"] = str(fields["permissions"])
        role.update(fields)
        self._write("edit_role", (role["name"], sorted(fields)))
        return dict(role)

    async def move_roles(self, guild_id: int, positions: list[dict[str, Any]]) -> None:
        guild = self.guilds[guild_id]
        bot_position = int(guild.roles[guild.bot_role]["position"])
        for entry in positions:
            # Discord: "400 Bad Request (error code: 50013): Missing Permissions".
            if int(entry["id"]) == guild.bot_role or entry["position"] >= bot_position:
                raise RuntimeError("Missing Permissions")
        for entry in positions:
            guild.roles[int(entry["id"])]["position"] = entry["position"]
        self._write("move_roles", len(positions))

    async def create_channel(self, guild_id: int, **fields: Any) -> dict[str, Any]:
        guild = self.guilds[guild_id]
        channel_id = guild.add_channel(
            fields["name"],
            fields["type"],
            int(fields["parent_id"]) if fields.get("parent_id") else None,
            [dict(o) for o in fields.get("permission_overwrites", [])],
        )
        if "position" in fields:
            guild.channels[channel_id]["position"] = fields["position"]
        self._write("create_channel", fields["name"])
        return dict(guild.channels[channel_id])

    async def edit_channel(self, channel_id: int, **fields: Any) -> dict[str, Any]:
        channel = self._guild_of(channel_id).channels[channel_id]
        if "permission_overwrites" in fields:
            fields["permission_overwrites"] = [dict(o) for o in fields["permission_overwrites"]]
        channel.update(fields)
        self._write("edit_channel", (channel["name"], sorted(fields)))
        return dict(channel)

    async def move_channels(self, guild_id: int, positions: list[dict[str, Any]]) -> None:
        guild = self.guilds[guild_id]
        for entry in positions:
            guild.channels[int(entry["id"])]["position"] = entry["position"]
        self._write("move_channels", len(positions))

    async def put_overwrite(
        self, channel_id: int, target_id: int, *, allow: int, deny: int, type: int
    ) -> None:
        channel = self._guild_of(channel_id).channels[channel_id]
        channel["permission_overwrites"] = [
            o for o in channel["permission_overwrites"] if int(o["id"]) != target_id
        ] + [{"id": str(target_id), "type": type, "allow": str(allow), "deny": str(deny)}]
        self._write("put_overwrite", (channel["name"], target_id))

    async def delete_overwrite(self, channel_id: int, target_id: int) -> None:
        channel = self._guild_of(channel_id).channels[channel_id]
        channel["permission_overwrites"] = [
            o for o in channel["permission_overwrites"] if int(o["id"]) != target_id
        ]
        self._write("delete_overwrite", (channel["name"], target_id))

    async def message_exists(self, channel_id: int, message_id: int) -> bool:
        return message_id in self.messages.get(channel_id, {})

    async def send_message(self, channel_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        message_id = next(self._ids)
        self.messages.setdefault(channel_id, {})[message_id] = payload
        self._write("send_message", channel_id)
        return {"id": str(message_id), **payload}

    async def edit_interaction_reply(self, token: str, payload: dict[str, Any]) -> None:
        self.interaction_replies.append((token, payload))
