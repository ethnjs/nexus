import asyncio
import logging
from unittest.mock import Mock

import discord
import httpx2
import pytest
from discord.http import Route

from app.services.discord import rest
from app.services.discord.rest import DiscordRest, DiscordWaitTooLong, InteractionReplyError


def test_changes_are_logged_without_nicknames_or_permissions(caplog):
    caplog.set_level(logging.INFO, logger=rest.__name__)
    member = Route("PATCH", "/guilds/{guild_id}/members/{user_id}", guild_id=1, user_id=2)
    rest.log_call(member, {"nick": "Pat S."})
    roles = Route("POST", "/guilds/{guild_id}/roles", guild_id=1)
    rest.log_call(roles, {"name": "Runner", "permissions": "8", "hoist": False})
    rest.log_call(Route("PATCH", "/guilds/{guild_id}/roles", guild_id=1), [{"id": "3"}] * 2)
    rest.log_call(Route("GET", "/guilds/{guild_id}", guild_id=1), None)
    assert caplog.messages == [
        "PATCH /guilds/1/members/2 (nick)",
        "POST /guilds/1/roles name='Runner' (hoist, permissions)",
        "PATCH /guilds/1/roles (2 positions)",
    ]


def test_refused_calls_are_logged_except_404s(caplog):
    caplog.set_level(logging.INFO, logger=rest.__name__)
    route = Route(
        "PUT",
        "/guilds/{guild_id}/members/{user_id}/roles/{role_id}",
        guild_id=1,
        user_id=2,
        role_id=3,
    )
    gone = discord.NotFound(Mock(status=404, reason="Not Found"), {"code": 10007})
    refused = discord.HTTPException(
        Mock(status=400, reason="Bad Request"), {"code": 50013, "message": "Missing Permissions"}
    )
    rest.log_call(route, None, gone)
    rest.log_call(route, None, refused)
    assert caplog.messages == [
        "Discord refused PUT /guilds/1/members/2/roles/3: "
        "400 Bad Request (error code: 50013): Missing Permissions"
    ]


async def test_adding_a_role_to_a_member_who_left_does_nothing(monkeypatch):
    async def unknown_member(self, route, **kwargs):
        raise discord.NotFound(
            Mock(status=404, reason="Not Found"), {"code": 10007, "message": "Unknown Member"}
        )

    monkeypatch.setattr(DiscordRest, "_request", unknown_member)
    await DiscordRest("token").add_member_role(1, 2, 3)


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
