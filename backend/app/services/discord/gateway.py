"""The bot's gateway connection. It keeps the bot online and receives server events; slash
commands and buttons arrive over HTTP instead (routes/discord/interactions.py)."""

import asyncio
import logging

import discord

from app.services.discord.commands import sync_commands

log = logging.getLogger(__name__)

# The bot never joins voice, so discord.py's warnings about missing voice libraries are noise.
discord.VoiceClient.warn_nacl = False
discord.VoiceClient.warn_dave = False

MISSING_ACCESS = 50001


class _Client(discord.Client):
    def __init__(self, *, dev_guild_id: int | None) -> None:
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

    async def setup_hook(self) -> None:
        await self._register_commands()

    async def on_guild_join(self, guild: discord.Guild) -> None:
        if guild.id == self._dev_guild_id:
            await self._register_commands()

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


class Gateway:
    """Runs one client as a background task. A closed discord.py client can't be restarted, so
    each start() builds a new one."""

    def __init__(self, token: str, *, dev_guild_id: int | None) -> None:
        self._token = token
        self._dev_guild_id = dev_guild_id
        self._client: _Client | None = None
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self._client = _Client(dev_guild_id=self._dev_guild_id)
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
