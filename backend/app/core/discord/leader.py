"""Leader election across every backend process sharing a database: uvicorn workers, Railway
replicas, and the old and new process during a rolling deploy.

Each process tries a session-level Postgres advisory lock on its own connection, outside the
request pool. The holder is the leader and runs the background work (LeaderWork). The lock
lives as long as that connection does, so if it drops, Postgres releases the lock and another
process takes over. Two leaders can overlap for up to one check interval, which is harmless
because every job is idempotent. Doesn't work behind PgBouncer in transaction-pooling mode.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable

import psycopg
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.engine import make_url

from app.core.config import discord_enabled, get_settings
from app.core.tournament.scheduler import start_scheduler
from app.services.discord.gateway import Gateway

log = logging.getLogger(__name__)

# Any constant works; every process using the same database must agree on it.
LOCK_KEY = 0x4E455855
CHECK_INTERVAL = 30.0


class Leader:
    def __init__(
        self,
        dsn: str,
        *,
        on_elected: Callable[[], Awaitable[None]],
        on_deposed: Callable[[], Awaitable[None]],
        interval: float = CHECK_INTERVAL,
        lock_key: int = LOCK_KEY,
    ) -> None:
        self._dsn = dsn
        self._on_elected = on_elected
        self._on_deposed = on_deposed
        self._interval = interval
        self._lock_key = lock_key
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        """Stops the leader's work, if it was leading, and releases the lock."""
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    async def _run(self) -> None:
        while True:
            conn = await asyncio.to_thread(self._try_acquire)
            if conn is None:
                await asyncio.sleep(self._interval)
                continue
            try:
                await self._lead(conn)
                log.warning("Lost the leader connection; competing for the lock again")
            except Exception:
                log.exception("The leader's work failed; competing for the lock again")
                await asyncio.sleep(self._interval)
            finally:
                await asyncio.to_thread(conn.close)

    async def _lead(self, conn: psycopg.Connection) -> None:
        log.info("Elected leader")
        try:
            await self._on_elected()
            while True:
                await asyncio.sleep(self._interval)
                if not await asyncio.to_thread(self._alive, conn):
                    return
        finally:
            await self._on_deposed()

    def _try_acquire(self) -> psycopg.Connection | None:
        try:
            conn = psycopg.connect(
                self._dsn,
                autocommit=True,
                connect_timeout=10,
                application_name="nexus-leader",
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=3,
            )
        except psycopg.Error:
            log.exception("Couldn't connect to compete for the leader lock")
            return None
        try:
            row = conn.execute("SELECT pg_try_advisory_lock(%s)", (self._lock_key,)).fetchone()
        except psycopg.Error:
            log.exception("Couldn't try the leader lock")
            conn.close()
            return None
        if row is None or not row[0]:
            conn.close()
            return None
        return conn

    def _alive(self, conn: psycopg.Connection) -> bool:
        try:
            conn.execute("SELECT 1")
        except psycopg.Error:
            return False
        return True


class LeaderWork:
    """What the leader runs: APScheduler and, when Discord is on, the gateway connection."""

    def __init__(self) -> None:
        self._scheduler: BackgroundScheduler | None = None
        self._gateway: Gateway | None = None

    async def start(self) -> None:
        self._scheduler = start_scheduler()
        settings = get_settings()
        if discord_enabled():
            dev_guild_id = (
                int(settings.discord_dev_guild_id) if settings.discord_dev_guild_id else None
            )
            self._gateway = Gateway(settings.discord_bot_token, dev_guild_id=dev_guild_id)
            await self._gateway.start()

    async def stop(self) -> None:
        if self._gateway is not None:
            await self._gateway.stop()
            self._gateway = None
        if self._scheduler is not None:
            self._scheduler.shutdown(wait=False)
            self._scheduler = None


def start_leader() -> Leader:
    work = LeaderWork()
    dsn = make_url(get_settings().database_url).set(drivername="postgresql")
    leader = Leader(
        dsn.render_as_string(hide_password=False), on_elected=work.start, on_deposed=work.stop
    )
    leader.start()
    return leader
