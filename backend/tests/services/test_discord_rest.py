import httpx2
import pytest

from app.services.discord.rest import DiscordRest, InteractionReplyError


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
