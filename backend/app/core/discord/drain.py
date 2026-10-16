"""The leader's listener on the `discord_sync` channel. Writes notify it in the same transaction
as the change, so it acts within a second of the commit."""

import asyncio
import logging
from typing import Protocol

import psycopg

from app.core.discord.links import CHANNEL

log = logging.getLogger(__name__)


class Leaver(Protocol):
    async def leave_guild(self, guild_id: int) -> None: ...


class Drain:
    def __init__(self, dsn: str, gateway: Leaver, *, wait: float = 1.0) -> None:
        self._dsn = dsn
        self._gateway = gateway
        self._wait = wait

    async def run(self) -> None:
        conn: psycopg.Connection | None = None
        try:
            while True:
                try:
                    if conn is None:
                        conn = await asyncio.to_thread(self._listen)
                    payloads = await asyncio.to_thread(self._receive, conn)
                except psycopg.Error:
                    log.exception("Lost the %s listener connection; reconnecting", CHANNEL)
                    if conn is not None:
                        await asyncio.to_thread(conn.close)
                    conn = None
                    await asyncio.sleep(5)
                    continue
                for payload in payloads:
                    await self._handle(payload)
        finally:
            if conn is not None:
                await asyncio.to_thread(conn.close)

    async def _handle(self, payload: str) -> None:
        if payload.startswith("leave:"):
            await self._gateway.leave_guild(int(payload.removeprefix("leave:")))

    def _listen(self) -> psycopg.Connection:
        conn = psycopg.connect(self._dsn, autocommit=True, application_name="nexus-discord-sync")
        conn.execute(f"LISTEN {CHANNEL}")
        return conn

    def _receive(self, conn: psycopg.Connection) -> list[str]:
        return [n.payload for n in conn.notifies(timeout=self._wait)]
