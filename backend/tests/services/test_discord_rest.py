import asyncio

import httpx2
import pytest

from app.services.discord import rest
from app.services.discord.rest import DiscordRest, DiscordWaitTooLong, InteractionReplyError


async def test_tests_cannot_reach_the_real_discord_api():
    with pytest.raises(AssertionError, match="real API: GET /guilds/"):
        await DiscordRest("token").guild(1)


async def test_a_failed_reply_edit_raises_without_the_token(monkeypatch):
    async def time_out(self, url, **kwargs):
        raise httpx2.ReadTimeout(f"timed out reaching {url}")

    monkeypatch.setattr(httpx2.AsyncClient, "patch", time_out)
    with pytest.raises(InteractionReplyError) as caught:
        await DiscordRest("token").edit_interaction_reply("secret-token", {"content": "Hi"})
    assert str(caught.value) == "editing the interaction reply failed: ReadTimeout"
    assert caught.value.__suppress_context__


async def test_rate_limits_with_requests_left_dont_raise():
    http = rest._http_client()
    try:
        assert http.max_ratelimit_timeout is None
    finally:
        await http.close()


async def test_a_request_waiting_past_the_deadline_fails(monkeypatch):
    monkeypatch.setattr(rest, "REQUEST_DEADLINE", 0.01)
    with pytest.raises(DiscordWaitTooLong):
        await rest._within_deadline(asyncio.sleep(5))


async def test_other_timeouts_pass_through():
    async def socket_timeout():
        raise TimeoutError

    with pytest.raises(TimeoutError) as caught:
        await rest._within_deadline(socket_timeout())
    assert not isinstance(caught.value, DiscordWaitTooLong)
