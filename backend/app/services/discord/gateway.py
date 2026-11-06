"""The bot's gateway connection. It keeps the bot online and receives server events; slash
commands and buttons arrive over HTTP instead (routes/discord/interactions.py)."""

import asyncio
import logging
from datetime import datetime
from typing import Protocol

import discord

from app.services.discord.commands import sync_commands

log = logging.getLogger(__name__)

# The bot never joins voice, so discord.py's warnings about missing voice libraries are noise.
discord.VoiceClient.warn_nacl = False
discord.VoiceClient.warn_dave = False

MISSING_ACCESS = 50001


class GatewayEvents(Protocol):
    """NEXUS-side reactions to gateway events. Called off the event loop, so they may block."""

    def guild_removed(self, guild_id: int) -> None: ...
    def guild_renamed(self, guild_id: int, name: str) -> None: ...
    def member_joined(self, guild_id: int, user_id: int) -> None: ...
    def role_deleted(self, guild_id: int, role_id: int) -> None: ...
    def channel_deleted(self, guild_id: int, channel_id: int) -> None: ...
    def channel_created(self, guild_id: int) -> None: ...
    def role_overwrites_removed(self, guild_id: int, role_ids: set[int]) -> None: ...


class _Client(discord.Client):
    def __init__(self, *, dev_guild_id: int | None, events: GatewayEvents) -> None:
        intents = discord.Intents.none()
        intents.guilds = True
        intents.members = True
        super().__init__(
            intents=intents,
            member_cache_flags=discord.MemberCacheFlags.none(),
            chunk_guilds_at_startup=False,
            status=discord.Status.online,
            activity=None,
        )
        self._dev_guild_id = dev_guild_id
        self._events = events

    async def setup_hook(self) -> None:
        await self._register_commands()

    async def on_guild_join(self, guild: discord.Guild) -> None:
        if guild.id == self._dev_guild_id:
            await self._register_commands()

    async def on_guild_remove(self, guild: discord.Guild) -> None:
        await asyncio.to_thread(self._events.guild_removed, guild.id)

    async def on_guild_update(self, before: discord.Guild, after: discord.Guild) -> None:
        if before.name != after.name:
            await asyncio.to_thread(self._events.guild_renamed, after.id, after.name)

    async def on_member_join(self, member: discord.Member) -> None:
        if not member.bot:
            await asyncio.to_thread(self._events.member_joined, member.guild.id, member.id)

    async def on_guild_role_delete(self, role: discord.Role) -> None:
        await asyncio.to_thread(self._events.role_deleted, role.guild.id, role.id)

    async def on_guild_channel_delete(self, channel: discord.abc.GuildChannel) -> None:
        await asyncio.to_thread(self._events.channel_deleted, channel.guild.id, channel.id)

    async def on_guild_channel_create(self, channel: discord.abc.GuildChannel) -> None:
        await asyncio.to_thread(self._events.channel_created, channel.guild.id)

    async def on_guild_channel_update(
        self, before: discord.abc.GuildChannel, after: discord.abc.GuildChannel
    ) -> None:
        removed = _role_targets(before) - _role_targets(after)
        if removed:
            await asyncio.to_thread(self._events.role_overwrites_removed, after.guild.id, removed)

    async def _register_commands(self) -> None:
        assert self.application_id is not None
        scope = f"server {self._dev_guild_id}" if self._dev_guild_id else "global"
        try:
            if await sync_commands(self.http, self.application_id, self._dev_guild_id):
                log.info("Registered slash commands (%s)", scope)
        except discord.HTTPException as exc:
            if self._dev_guild_id and exc.code == MISSING_ACCESS:
                log.warning(
                    "Couldn't register slash commands: the bot isn't in DISCORD_DEV_GUILD_ID %s "
                    "yet. They register when it joins.",
                    self._dev_guild_id,
                )
            else:
                log.exception("Couldn't register slash commands (%s)", scope)

    async def on_ready(self) -> None:
        assert self.user is not None
        log.info("Connected to Discord as %s, in %d servers", self.user, len(self.guilds))


def _role_targets(channel: discord.abc.GuildChannel) -> set[int]:
    return {target.id for target in channel.overwrites if isinstance(target, discord.Role)}


class Gateway:
    """Runs one client as a background task. A closed discord.py client can't be restarted, so
    each start() builds a new one."""

    def __init__(self, token: str, *, dev_guild_id: int | None, events: GatewayEvents) -> None:
        self._token = token
        self._dev_guild_id = dev_guild_id
        self._events = events
        self._client: _Client | None = None
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self._client = _Client(dev_guild_id=self._dev_guild_id, events=self._events)
        self._task = asyncio.create_task(self._run(self._client))

    async def _run(self, client: _Client) -> None:
        try:
            await client.start(self._token)
        except discord.LoginFailure:
            log.error("Discord rejected DISCORD_BOT_TOKEN; the bot stays offline")
        except discord.PrivilegedIntentsRequired:
            log.error(
                "Turn on the Server Members intent in the Discord developer portal; "
                "the bot stays offline"
            )
        except Exception:
            log.exception("The Discord gateway connection stopped")

    async def stop(self) -> None:
        if self._client is not None:
            # Closes with code 1000, which shows the bot offline right away.
            await self._client.close()
        if self._task is not None:
            await asyncio.gather(self._task, return_exceptions=True)
        self._client = None
        self._task = None

    async def wait_until_ready(self) -> None:
        assert self._client is not None
        await self._client.wait_until_ready()

    def guilds(self) -> list[tuple[int, datetime | None]]:
        """Every server the bot is in, with when the bot joined it."""
        if self._client is None:
            return []
        return [(g.id, g.me.joined_at if g.me else None) for g in self._client.guilds]

    async def leave_guild(self, guild_id: int) -> None:
        if self._client is None:
            return
        try:
            await self._client.http.leave_guild(guild_id)
        except discord.NotFound:
            return
        except discord.HTTPException:
            log.exception("Couldn't leave server %s", guild_id)
            return
        log.info("Left server %s", guild_id)
