"""The leader's side of server links: leave notifications, the listener, the sweep's leave rule
and the gateway's server events. Notifications use the real test database, outside the
rolled-back test transaction, because Postgres delivers them only on commit."""

import asyncio
from datetime import timedelta

import psycopg
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.discord.drain import Drain
from app.core.discord.events import mark_bot_removed, rename_guild
from app.core.discord.links import CHANNEL, notify_leave
from app.core.discord.sweep import INSTALL_GRACE, guilds_to_leave
from app.models.discord import DiscordGuildLink
from app.models.models import utcnow
from tests.conftest import TEST_DATABASE_URL, primary_track_id


def _listen() -> psycopg.Connection:
    conn = psycopg.connect(TEST_DATABASE_URL, autocommit=True)
    conn.execute(f"LISTEN {CHANNEL}")
    return conn


def _received(conn: psycopg.Connection) -> list[str]:
    return [n.payload for n in conn.notifies(timeout=0.5)]


def test_leave_notification_is_sent_only_when_the_transaction_commits():
    engine = create_engine(TEST_DATABASE_URL)
    listener = _listen()
    try:
        with Session(engine) as session:
            notify_leave(session, 123)
            session.rollback()
        assert _received(listener) == []

        with Session(engine) as session:
            notify_leave(session, 456)
            assert _received(listener) == []
            session.commit()
        assert _received(listener) == ["leave:456"]
    finally:
        listener.close()
        engine.dispose()


class FakeGateway:
    def __init__(self) -> None:
        self.left: list[int] = []

    async def leave_guild(self, guild_id: int) -> None:
        self.left.append(guild_id)


async def test_drain_leaves_the_server_named_in_a_leave_notification():
    gateway = FakeGateway()
    task = asyncio.create_task(Drain(TEST_DATABASE_URL, gateway, wait=0.05).run())
    try:
        with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
            # The listener connects in the background; keep notifying until it hears one.
            for _ in range(100):
                conn.execute("SELECT pg_notify(%s, %s)", (CHANNEL, "leave:789"))
                await asyncio.sleep(0.05)
                if gateway.left:
                    break
            conn.execute("SELECT pg_notify(%s, %s)", (CHANNEL, ""))
        assert set(gateway.left) == {789}
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


def test_sweep_leaves_only_unlinked_servers_past_the_grace_period():
    now = utcnow()
    old = now - INSTALL_GRACE - timedelta(minutes=1)
    recent = now - INSTALL_GRACE + timedelta(minutes=1)
    guilds = [(1, old), (2, old), (3, recent), (4, None)]
    assert guilds_to_leave(guilds, linked={2}, now=now) == [1]


def test_bot_removed_from_a_linked_server(db, td_tournament):
    link = DiscordGuildLink(
        tournament_id=td_tournament.id, track_id=primary_track_id(db, td_tournament.id), guild_id=7
    )
    db.add(link)
    db.commit()

    mark_bot_removed(db, 8)
    assert link.bot_removed_at is None
    mark_bot_removed(db, 7)
    assert link.bot_removed_at is not None


def test_renamed_server(db, td_tournament):
    link = DiscordGuildLink(
        tournament_id=td_tournament.id,
        track_id=primary_track_id(db, td_tournament.id),
        guild_id=7,
        guild_name="Old",
    )
    db.add(link)
    db.commit()

    rename_guild(db, 7, "New")
    assert link.guild_name == "New"
    rename_guild(db, 8, "Unlinked")
    assert link.guild_name == "New"
