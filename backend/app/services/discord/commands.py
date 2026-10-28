"""Slash command definitions, and registering them with Discord when they change."""

from collections.abc import Awaitable
from typing import Any, Protocol

MANAGE_CHANNELS = 1 << 4
GUILD_TEXT = 0
GUILD_CATEGORY = 4
OPTION_CHANNEL = 7
OPTION_ROLE = 8

# Hides the staff commands from members without Manage Channels. NEXUS's own
# manage_discord check is the real gate.
_STAFF_ONLY = {"default_member_permissions": str(MANAGE_CHANNELS)}
# Guild install only, usable only inside servers. Discord ignores both on guild-scoped commands.
_GLOBAL_ONLY_KEYS = ("contexts", "integration_types")
_IN_SERVERS = {"contexts": [0], "integration_types": [0]}

COMMANDS: list[dict[str, Any]] = [
    {
        "name": "link",
        "description": "Link your Discord account to your NEXUS account",
        **_IN_SERVERS,
    },
    {
        "name": "whoami",
        "description": "Show your linked NEXUS account and your roles in this tournament",
        **_IN_SERVERS,
    },
    {
        "name": "sync",
        "description": "Sync members' roles and this server's channels with NEXUS now",
        **_IN_SERVERS,
        **_STAFF_ONLY,
    },
    {
        "name": "setup",
        "description": "Preview, then build this server's NEXUS roles and channels",
        **_IN_SERVERS,
        **_STAFF_ONLY,
    },
    {
        "name": "reset",
        "description": "Preview, then restore NEXUS defaults for the whole server or one role or channel",
        **_IN_SERVERS,
        **_STAFF_ONLY,
        "options": [
            {
                "type": OPTION_ROLE,
                "name": "role",
                "description": "Reset only this NEXUS role",
                "required": False,
            },
            {
                "type": OPTION_CHANNEL,
                "name": "channel",
                "description": "Reset only this NEXUS channel or category",
                "required": False,
                "channel_types": [GUILD_TEXT, GUILD_CATEGORY],
            },
        ],
    },
]


class CommandsHTTP(Protocol):
    """The slice of discord.py's HTTPClient used here."""

    def get_global_commands(self, application_id: int) -> Awaitable[Any]: ...
    def get_guild_commands(self, application_id: int, guild_id: int) -> Awaitable[Any]: ...
    def bulk_upsert_global_commands(
        self, application_id: int, payload: list[dict[str, Any]]
    ) -> Awaitable[Any]: ...
    def bulk_upsert_guild_commands(
        self, application_id: int, guild_id: int, payload: list[dict[str, Any]]
    ) -> Awaitable[Any]: ...


def definitions(*, guild_scoped: bool) -> list[dict[str, Any]]:
    if not guild_scoped:
        return COMMANDS
    return [{k: v for k, v in c.items() if k not in _GLOBAL_ONLY_KEYS} for c in COMMANDS]


def _comparable(command: dict[str, Any], *, guild_scoped: bool) -> dict[str, Any]:
    """The fields NEXUS sets, with Discord's defaults filled in, so a fetched command compares
    equal to its definition."""
    result = {
        "name": command["name"],
        "description": command["description"],
        "type": command.get("type", 1),
        "default_member_permissions": command.get("default_member_permissions"),
        "options": [
            {
                "type": o["type"],
                "name": o["name"],
                "description": o["description"],
                "required": o.get("required", False),
                "channel_types": sorted(o.get("channel_types") or []),
            }
            for o in command.get("options") or []
        ],
    }
    if not guild_scoped:
        for key in _GLOBAL_ONLY_KEYS:
            result[key] = sorted(command.get(key) or [])
    return result


def _key(command: dict[str, Any]) -> str:
    return command["name"]


async def sync_commands(http: CommandsHTTP, application_id: int, guild_id: int | None) -> bool:
    """Bulk-overwrites the registered commands if they differ from COMMANDS; global unless
    `guild_id` is given. Returns whether it wrote. Discord caps command creates at 200 a day per
    server, so an unchanged set is never rewritten."""
    guild_scoped = guild_id is not None
    desired = definitions(guild_scoped=guild_scoped)
    if guild_id is not None:
        existing = await http.get_guild_commands(application_id, guild_id)
    else:
        existing = await http.get_global_commands(application_id)

    def normalized(commands: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted((_comparable(c, guild_scoped=guild_scoped) for c in commands), key=_key)

    if normalized(existing) == normalized(desired):
        return False
    if guild_id is not None:
        await http.bulk_upsert_guild_commands(application_id, guild_id, desired)
    else:
        await http.bulk_upsert_global_commands(application_id, desired)
    return True
