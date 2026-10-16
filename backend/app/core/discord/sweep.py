"""The leader's 15-minute sweep: the safety net for anything a notification missed."""

import asyncio
import logging
from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Protocol

from app.models.discord import DiscordGuildLink
from app.models.models import utcnow

log = logging.getLogger(__name__)

INTERVAL = timedelta(minutes=15)
# The bot joins a server before the install callback saves its link.
INSTALL_GRACE = timedelta(hours=1)


class SweepGateway(Protocol):
    async def wait_until_ready(self) -> None: ...
    def guilds(self) -> list[tuple[int, datetime | None]]: ...
    async def leave_guild(self, guild_id: int) -> None: ...


def guilds_to_leave(
    guilds: Iterable[tuple[int, datetime | None]], linked: set[int], now: datetime
) -> list[int]:
    """Servers with no link that the bot joined more than INSTALL_GRACE ago."""
    return [
        guild_id
        for guild_id, joined_at in guilds
        if guild_id not in linked and joined_at is not None and now - joined_at > INSTALL_GRACE
    ]


def linked_guild_ids() -> set[int]:
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        return {guild_id for (guild_id,) in db.query(DiscordGuildLink.guild_id)}


async def run_sweep(gateway: SweepGateway) -> None:
    await gateway.wait_until_ready()
    while True:
        try:
            linked = await asyncio.to_thread(linked_guild_ids)
            for guild_id in guilds_to_leave(gateway.guilds(), linked, utcnow()):
                log.info("Leaving server %s, which no track is linked to", guild_id)
                await gateway.leave_guild(guild_id)
        except Exception:
            log.exception("The Discord sweep failed")
        await asyncio.sleep(INTERVAL.total_seconds())
