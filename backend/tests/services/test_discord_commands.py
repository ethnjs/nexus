"""Slash command registration against a fake discord.py HTTP client."""

import copy
from typing import Any

from app.services.discord.commands import COMMANDS, definitions, sync_commands

APP_ID = 1000
GUILD_ID = 2000


class FakeHTTP:
    def __init__(self, registered: list[dict[str, Any]]) -> None:
        self.registered = registered
        self.writes: list[tuple[int | None, list[dict[str, Any]]]] = []

    async def get_global_commands(self, application_id: int) -> list[dict[str, Any]]:
        return self.registered

    async def get_guild_commands(self, application_id: int, guild_id: int) -> list[dict[str, Any]]:
        return self.registered

    async def bulk_upsert_global_commands(
        self, application_id: int, payload: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        self.writes.append((None, payload))
        return payload

    async def bulk_upsert_guild_commands(
        self, application_id: int, guild_id: int, payload: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        self.writes.append((guild_id, payload))
        return payload


def _as_discord_returns(commands: list[dict[str, Any]], *, guild: bool) -> list[dict[str, Any]]:
    """Registered commands as Discord sends them back: extra fields, defaults spelled out."""
    result = []
    for i, command in enumerate(copy.deepcopy(commands)):
        command.update(
            id=str(9000 + i),
            application_id=str(APP_ID),
            version="1",
            type=1,
            nsfw=False,
            default_permission=True,
        )
        command.setdefault("default_member_permissions", None)
        if guild:
            command.update(guild_id=str(GUILD_ID), contexts=None, integration_types=[0])
        for option in command.get("options", []):
            option.setdefault("channel_types", None)
        result.append(command)
    return list(reversed(result))


async def test_first_run_registers_global_commands():
    http = FakeHTTP([])
    assert await sync_commands(http, APP_ID, None) is True
    assert http.writes == [(None, COMMANDS)]


async def test_unchanged_global_commands_are_not_rewritten():
    http = FakeHTTP(_as_discord_returns(COMMANDS, guild=False))
    assert await sync_commands(http, APP_ID, None) is False
    assert http.writes == []


async def test_changed_definition_is_rewritten():
    stale = copy.deepcopy(COMMANDS)
    stale[0]["description"] = "Old wording"
    http = FakeHTTP(_as_discord_returns(stale, guild=False))
    assert await sync_commands(http, APP_ID, None) is True
    assert http.writes == [(None, COMMANDS)]


async def test_removed_command_is_rewritten():
    http = FakeHTTP(_as_discord_returns(COMMANDS[:-1], guild=False))
    assert await sync_commands(http, APP_ID, None) is True


async def test_dev_guild_gets_guild_commands_without_global_only_fields():
    http = FakeHTTP([])
    assert await sync_commands(http, APP_ID, GUILD_ID) is True
    [(guild_id, payload)] = http.writes
    assert guild_id == GUILD_ID
    assert payload == definitions(guild_scoped=True)
    assert all("contexts" not in c and "integration_types" not in c for c in payload)

    http = FakeHTTP(_as_discord_returns(payload, guild=True))
    assert await sync_commands(http, APP_ID, GUILD_ID) is False


def test_staff_commands_are_hidden_from_members_without_manage_channels():
    by_name = {c["name"]: c for c in COMMANDS}
    assert by_name.keys() == {"link", "whoami", "sync", "setup", "reset"}
    for name in ("sync", "setup", "reset"):
        assert by_name[name]["default_member_permissions"] == str(1 << 4)
    for name in ("link", "whoami"):
        assert "default_member_permissions" not in by_name[name]
    assert all(c["contexts"] == [0] for c in COMMANDS)
