"""Leader election against the real test database, with a short check interval."""

import asyncio
from collections.abc import Callable

import psycopg

from app.core.discord.leader import Leader
from tests.conftest import TEST_DATABASE_URL

# Not leader.LOCK_KEY, so these tests never contend with each other's leftovers by accident.
TEST_LOCK_KEY = 0x7E57


async def _wait_for(predicate: Callable[[], bool], timeout: float = 5.0) -> None:
    async def poll() -> None:
        while not predicate():
            await asyncio.sleep(0.02)

    await asyncio.wait_for(poll(), timeout)


def _contender(name: str, events: list[tuple[str, str]]) -> Leader:
    async def elected() -> None:
        events.append((name, "elected"))

    async def deposed() -> None:
        events.append((name, "deposed"))

    return Leader(
        TEST_DATABASE_URL,
        on_elected=elected,
        on_deposed=deposed,
        interval=0.05,
        lock_key=TEST_LOCK_KEY,
    )


async def test_one_contender_leads_and_the_other_takes_over():
    events: list[tuple[str, str]] = []
    a, b = _contender("a", events), _contender("b", events)
    try:
        a.start()
        await _wait_for(lambda: ("a", "elected") in events)
        b.start()
        await asyncio.sleep(0.3)
        assert events == [("a", "elected")]

        await a.stop()
        await _wait_for(lambda: ("b", "elected") in events)
        assert events == [("a", "elected"), ("a", "deposed"), ("b", "elected")]
    finally:
        await a.stop()
        await b.stop()
    assert events[-1] == ("b", "deposed")


async def test_lost_connection_stops_the_work_and_competes_again():
    events: list[tuple[str, str]] = []
    a = _contender("a", events)
    try:
        a.start()
        await _wait_for(lambda: ("a", "elected") in events)

        with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as admin:
            admin.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_locks "
                "WHERE locktype = 'advisory' AND classid = 0 AND objid = %s",
                (TEST_LOCK_KEY,),
            )

        await _wait_for(lambda: events.count(("a", "elected")) == 2)
        assert events == [("a", "elected"), ("a", "deposed"), ("a", "elected")]
    finally:
        await a.stop()
