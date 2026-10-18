"""The leader's 15-minute sweep: the safety net for anything a mark missed. It writes a full mark
for every server that syncs, which reverts hand edits to members' roles, and makes the bot leave
servers no track is linked to."""

import asyncio
import logging
from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Protocol

from sqlalchemy.orm import Session

from app.core.discord.marks import mark_full
from app.models.discord import DiscordGuildLink
from app.models.models import Tournament, TournamentTrack, utcnow

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


def mark_all_full(db: Session) -> None:
    """A full mark for every built server the bot is in, outside archived tournaments and tracks
    being deleted. Commits."""
    links = (
        db.query(DiscordGuildLink.id)
        .join(Tournament, Tournament.id == DiscordGuildLink.tournament_id)
        .join(TournamentTrack, TournamentTrack.id == DiscordGuildLink.track_id)
        .filter(
            DiscordGuildLink.built_at.isnot(None),
            DiscordGuildLink.bot_removed_at.is_(None),
            Tournament.is_archived.is_(False),
            TournamentTrack.is_archived.is_(False),
        )
    )
    for (link_id,) in links:
        mark_full(db, link_id)
    db.commit()


def _sweep_database() -> set[int]:
    """Marks every syncing server, and returns every linked guild id."""
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        mark_all_full(db)
        return {guild_id for (guild_id,) in db.query(DiscordGuildLink.guild_id)}


async def run_sweep(gateway: SweepGateway) -> None:
    await gateway.wait_until_ready()
    while True:
        try:
            linked = await asyncio.to_thread(_sweep_database)
            for guild_id in guilds_to_leave(gateway.guilds(), linked, utcnow()):
                log.info("Leaving server %s, which no track is linked to", guild_id)
                await gateway.leave_guild(guild_id)
        except Exception:
            log.exception("The Discord sweep failed")
        await asyncio.sleep(INTERVAL.total_seconds())
