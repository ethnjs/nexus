"""The gateway's restarts, with discord.py's client stubbed out: nothing connects to Discord."""

import asyncio
from unittest.mock import Mock

import discord
import pytest

from app.services.discord import gateway as gateway_module
from app.services.discord.gateway import Gateway, _Client


@pytest.fixture
def starts(monkeypatch) -> list[_Client]:
    """Each client the gateway starts. The first start fails like a Discord outage at login;
    later ones stay connected until closed."""
    started: list[_Client] = []

    async def start(self, token):
        started.append(self)
        if len(started) == 1:
            raise discord.DiscordServerError(Mock(status=503, reason="Service Unavailable"), "")
        await asyncio.Event().wait()

    async def close(self):
        return None

    monkeypatch.setattr(_Client, "start", start)
    monkeypatch.setattr(_Client, "close", close)
    monkeypatch.setattr(gateway_module, "FIRST_RETRY_SECONDS", 0.0)
    return started


async def _wait_for(predicate, timeout: float = 2.0) -> None:
    async def poll():
        while not predicate():
            await asyncio.sleep(0.01)

    await asyncio.wait_for(poll(), timeout)


async def test_a_failed_start_is_retried_with_a_new_client(starts):
    gateway = Gateway("token", dev_guild_id=None, events=Mock())
    await gateway.start()
    await _wait_for(lambda: len(starts) == 2)
    assert starts[0] is not starts[1]
    await gateway.stop()


async def test_a_rejected_token_isnt_retried(starts, monkeypatch):
    async def rejected(self, token):
        starts.append(self)
        raise discord.LoginFailure("Improper token has been passed.")

    monkeypatch.setattr(_Client, "start", rejected)
    gateway = Gateway("token", dev_guild_id=None, events=Mock())
    await gateway.start()
    await _wait_for(lambda: len(starts) == 1)
    await asyncio.sleep(0.05)
    assert len(starts) == 1
    await gateway.stop()


async def test_stopping_ends_the_retries(starts, monkeypatch):
    monkeypatch.setattr(gateway_module, "FIRST_RETRY_SECONDS", 3600.0)
    gateway = Gateway("token", dev_guild_id=None, events=Mock())
    await gateway.start()
    await _wait_for(lambda: len(starts) == 1)
    await asyncio.wait_for(gateway.stop(), 1.0)
