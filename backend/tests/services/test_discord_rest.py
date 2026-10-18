import pytest

from app.services.discord.rest import DiscordRest


async def test_tests_cannot_reach_the_real_discord_api():
    with pytest.raises(AssertionError, match="real API: GET /guilds/"):
        await DiscordRest("token").guild(1)
