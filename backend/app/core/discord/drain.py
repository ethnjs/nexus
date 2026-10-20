"""The leader's sync loop. It wakes on the `discord_sync` notification that every mark sends, or
every 5 seconds, claims due marks, and reconciles them.

Claiming locks marks with FOR UPDATE SKIP LOCKED and leases them for 10 minutes, so a leader
that dies mid-reconcile leaves them to be retried rather than lost. A reconcile that succeeds
deletes only marks written before its claim: a change made while it ran re-arms its mark and is
picked up next time. A failure backs the marks off exponentially, up to an hour.
"""

import asyncio
import contextlib
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

import psycopg
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.discord import build
from app.core.discord.eligibility import DesiredMember, desired_members
from app.core.discord.links import CHANNEL, link_for_guild
from app.core.discord.reconcile import (
    above_bot_message,
    all_members,
    apply_member,
    fetch_roles,
    plan_structure,
)
from app.models.discord import DiscordGuildLink, DiscordSyncMark
from app.services.discord import rest as discord_rest

log = logging.getLogger(__name__)

LEASE = timedelta(minutes=10)
BUSY_RETRY = timedelta(seconds=30)
MAX_BACKOFF = timedelta(hours=1)
BATCH = 200

SessionScope = Callable[[], contextlib.AbstractContextManager[Session]]


@dataclass(frozen=True)
class Claimed:
    id: int
    kind: str
    discord_user_id: int | None
    attempts: int


def backoff(attempts: int) -> timedelta:
    return min(timedelta(seconds=5 * 2**attempts), MAX_BACKOFF)


def claim_marks(db: Session, limit: int = BATCH) -> tuple[datetime, dict[int, list[Claimed]]]:
    """Leases the due marks, grouped by server link, and returns them with the claim time."""
    now = db.scalar(select(func.clock_timestamp()))
    assert now is not None
    rows = (
        db.query(DiscordSyncMark)
        .filter(DiscordSyncMark.next_attempt_at <= now)
        .order_by(DiscordSyncMark.next_attempt_at, DiscordSyncMark.id)
        .limit(limit)
        .with_for_update(skip_locked=True)
        .all()
    )
    by_link: dict[int, list[Claimed]] = {}
    for row in rows:
        row.next_attempt_at = now + LEASE
        by_link.setdefault(row.link_id, []).append(
            Claimed(row.id, row.kind, row.discord_user_id, row.attempts)
        )
    db.commit()
    return now, by_link


def _settle(db: Session, ids: list[int], claimed_at: datetime) -> None:
    db.query(DiscordSyncMark).filter(
        DiscordSyncMark.id.in_(ids), DiscordSyncMark.created_at <= claimed_at
    ).delete(synchronize_session=False)


def _retry(db: Session, marks: list[Claimed], delay: timedelta | None = None) -> None:
    now = db.scalar(select(func.clock_timestamp()))
    assert now is not None
    for mark in marks:
        row = db.get(DiscordSyncMark, mark.id)
        if row is None:
            continue
        if delay is None:
            row.attempts = mark.attempts + 1
            row.next_attempt_at = now + backoff(mark.attempts)
        else:
            row.next_attempt_at = now + delay


class Syncer:
    """Reconciles claimed marks. Database work runs in threads, never on the event loop."""

    def __init__(self, session_scope: SessionScope = build.default_session_scope) -> None:
        self._scope = session_scope

    async def _in_db[T](self, fn: Callable[[Session], T]) -> T:
        def run() -> T:
            with self._scope() as db:
                result = fn(db)
                db.commit()
                return result

        return await asyncio.to_thread(run)

    async def run_pending(self) -> None:
        while True:
            claimed_at, by_link = await self._in_db(claim_marks)
            for link_id, marks in by_link.items():
                await self.sync_link(link_id, marks, claimed_at)
            if sum(len(m) for m in by_link.values()) < BATCH:
                return

    async def sync_link(self, link_id: int, marks: list[Claimed], claimed_at: datetime) -> None:
        state = await self._in_db(lambda db: _link_state(db, link_id))
        if state == "gone":
            return
        if state == "skip":
            # Builds, unarchiving and cancelled track deletions write a full mark to catch up.
            await self._in_db(lambda db: _settle(db, [m.id for m in marks], claimed_at))
            return
        if state == "busy":
            await self._in_db(lambda db: _retry(db, marks, BUSY_RETRY))
            return

        kinds = {m.kind for m in marks}
        try:
            if "full" in kinds or "structure" in kinds:
                above_bot = await self._sync_structure(link_id)
                if above_bot is None:
                    await self._in_db(lambda db: _retry(db, marks, BUSY_RETRY))
                    return
                if "full" in kinds:
                    await self._sync_everyone(link_id, above_bot)
                else:
                    accounts = [m.discord_user_id for m in marks if m.kind == "member"]
                    await self._sync_members(link_id, accounts, above_bot)
        except Exception as exc:
            log.exception("Discord sync for link %s failed", link_id)
            error = exc
            await self._in_db(lambda db: _fail(db, link_id, marks, error))
            return

        if "full" in kinds or "structure" in kinds:

            def done(db: Session) -> None:
                if "full" in kinds:
                    ids = [
                        i
                        for (i,) in db.query(DiscordSyncMark.id).filter(
                            DiscordSyncMark.link_id == link_id
                        )
                    ]
                else:
                    ids = [m.id for m in marks]
                _settle(db, ids, claimed_at)
                _succeeded(db, link_id, above_bot_message(above_bot), whole_server=True)

            await self._in_db(done)
            return
        await self._sync_member_marks(link_id, marks, claimed_at)

    async def _sync_member_marks(
        self, link_id: int, marks: list[Claimed], claimed_at: datetime
    ) -> None:
        above_bot: set[str] = set()
        failed: list[Claimed] = []
        errors: list[Exception] = []
        try:
            snapshot, live, desired = await self._member_context(
                link_id, [m.discord_user_id for m in marks if m.discord_user_id is not None]
            )
        except Exception as exc:
            log.exception("Discord member sync for link %s failed", link_id)
            error = exc
            await self._in_db(lambda db: _fail(db, link_id, marks, error))
            return
        rest = discord_rest.get_rest()
        for mark in marks:
            assert mark.discord_user_id is not None
            try:
                member = await rest.member(snapshot.guild_id, mark.discord_user_id)
                # Not in the server, which is the usual case right after linking.
                if member is not None:
                    wanted = desired.get(mark.discord_user_id)
                    await apply_member(rest, snapshot, live, member, wanted, above_bot)
            except Exception as exc:
                log.exception("Discord member sync for link %s failed", link_id)
                failed.append(mark)
                errors.append(exc)

        def done(db: Session) -> None:
            _settle(db, [m.id for m in marks if m not in failed], claimed_at)
            if failed:
                _fail(db, link_id, failed, errors[-1])
            elif above_bot or not _retrying(db, link_id):
                _succeeded(db, link_id, above_bot_message(above_bot), whole_server=False)

        await self._in_db(done)

    async def _member_context(
        self, link_id: int, accounts: list[int | None]
    ) -> tuple[build.Snapshot, build.Live, dict[int, DesiredMember]]:
        def load(db: Session) -> tuple[build.Snapshot, dict[int, DesiredMember]]:
            link = db.get(DiscordGuildLink, link_id)
            assert link is not None
            ids = [a for a in accounts if a is not None]
            return build.load_snapshot(db, link_id), desired_members(db, link, ids)

        snapshot, desired = await self._in_db(load)
        live = await fetch_roles(discord_rest.get_rest(), snapshot)
        return snapshot, live, desired

    async def _sync_structure(self, link_id: int) -> set[str] | None:
        """The roles above the bot's, or None if a build started and holds the link."""
        if not await self._in_db(lambda db: build.claim_sync(db, link_id)):
            return None
        try:
            snapshot = await self._in_db(lambda db: build.load_snapshot(db, link_id))
            rest = discord_rest.get_rest()
            live = await build.fetch_live(rest, snapshot)
            plan, above_bot = plan_structure(snapshot, live)
            if plan.actions:
                store = build.Store(self._scope)
                await build.execute(
                    plan, snapshot, live, rest, store, heartbeat=store.sync_heartbeat
                )
            return above_bot
        finally:
            await self._in_db(lambda db: build.release_sync(db, link_id))

    async def _sync_members(
        self, link_id: int, accounts: list[int | None], above_bot: set[str]
    ) -> None:
        if not accounts:
            return
        snapshot, live, desired = await self._member_context(link_id, accounts)
        rest = discord_rest.get_rest()
        for account in accounts:
            assert account is not None
            member = await rest.member(snapshot.guild_id, account)
            if member is not None:
                await apply_member(rest, snapshot, live, member, desired.get(account), above_bot)

    async def _sync_everyone(self, link_id: int, above_bot: set[str]) -> None:
        snapshot = await self._in_db(lambda db: build.load_snapshot(db, link_id))
        rest = discord_rest.get_rest()
        live = await fetch_roles(rest, snapshot)
        members = await all_members(rest, snapshot.guild_id)
        ids = [int(m["user"]["id"]) for m in members if not m["user"].get("bot")]

        def desired_for(db: Session) -> dict[int, DesiredMember]:
            link = db.get(DiscordGuildLink, link_id)
            assert link is not None
            return desired_members(db, link, ids)

        desired = await self._in_db(desired_for)
        for member in members:
            wanted = desired.get(int(member["user"]["id"]))
            await apply_member(rest, snapshot, live, member, wanted, above_bot)


def _link_state(db: Session, link_id: int) -> str:
    link = db.get(DiscordGuildLink, link_id)
    if link is None:
        return "gone"
    if (
        link.built_at is None
        or link.bot_removed_at is not None
        or link.tournament.is_archived
        or link.track.is_archived
    ):
        return "skip"
    if build.build_running(link):
        return "busy"
    return "sync"


def _succeeded(db: Session, link_id: int, warning: str | None, *, whole_server: bool) -> None:
    """Clears the failure. A whole-server sync also replaces the warning; a member sync only
    adds one, since it saw just a few members."""
    link = db.get(DiscordGuildLink, link_id)
    if link is None:
        return
    link.last_sync_error = None
    if whole_server or warning is not None:
        link.last_sync_warning = warning


def _retrying(db: Session, link_id: int) -> bool:
    """Whether a mark for this link is backing off after a failure, whose error should stay."""
    return (
        db.query(DiscordSyncMark.id)
        .filter(DiscordSyncMark.link_id == link_id, DiscordSyncMark.attempts > 0)
        .first()
        is not None
    )


def _fail(db: Session, link_id: int, marks: list[Claimed], exc: Exception) -> None:
    _retry(db, marks)
    link = db.get(DiscordGuildLink, link_id)
    if link is not None:
        link.last_sync_error = (str(exc) or type(exc).__name__)[:2000]


class Leaver(Protocol):
    async def leave_guild(self, guild_id: int) -> None: ...


class PendingSync(Protocol):
    async def run_pending(self) -> None: ...


class Drain:
    def __init__(
        self,
        dsn: str,
        gateway: Leaver,
        *,
        wait: float = 5.0,
        syncer: PendingSync | None = None,
        session_scope: SessionScope = build.default_session_scope,
    ) -> None:
        self._dsn = dsn
        self._gateway = gateway
        self._wait = wait
        self._scope = session_scope
        self._syncer: PendingSync = syncer or Syncer()

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
                    try:
                        await self._handle(payload)
                    except Exception:
                        log.exception("Couldn't act on the %s notification %r", CHANNEL, payload)
                try:
                    await self._syncer.run_pending()
                except Exception:
                    log.exception("The Discord sync loop failed")
        finally:
            if conn is not None:
                await asyncio.to_thread(conn.close)

    async def _handle(self, payload: str) -> None:
        if payload.startswith("leave:"):
            guild_id = int(payload.removeprefix("leave:"))
            # A server linked again since the leave was queued keeps the bot.
            if not await asyncio.to_thread(self._is_linked, guild_id):
                await self._gateway.leave_guild(guild_id)

    def _is_linked(self, guild_id: int) -> bool:
        with self._scope() as db:
            return link_for_guild(db, guild_id) is not None

    def _listen(self) -> psycopg.Connection:
        # Keepalives notice a connection dropped without an error, which LISTEN alone never would.
        conn = psycopg.connect(
            self._dsn,
            autocommit=True,
            connect_timeout=10,
            application_name="nexus-discord-sync",
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=3,
        )
        conn.execute(f"LISTEN {CHANNEL}")
        return conn

    def _receive(self, conn: psycopg.Connection) -> list[str]:
        # stop_after returns as soon as one arrives; without it this waits out the whole timeout.
        return [n.payload for n in conn.notifies(timeout=self._wait, stop_after=1)]
