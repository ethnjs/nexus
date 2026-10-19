"""Discord's REST API as the bot, through discord.py's HTTP client, which waits out rate limits
and retries. Every call NEXUS makes goes through one DiscordRest, from get_rest(), so tests
replace that one function with an in-memory server."""

import asyncio
from typing import Any

import discord
import httpx2
from discord.http import HTTPClient, Route

from app.core.config import get_settings

GUILD_TEXT = 0
GUILD_CATEGORY = 4
ROLE_OVERWRITE = 0
MEMBER_OVERWRITE = 1
# Longer rate-limit waits raise discord.RateLimited instead. A build or sync that waited one out
# would go over two minutes without a heartbeat, and its claim would be taken for dead.
MAX_RATE_LIMIT_WAIT = 60.0


class DiscordRest:
    def __init__(self, token: str) -> None:
        self._token = token
        self._http: HTTPClient | None = None
        self._login: asyncio.Lock | None = None
        self.bot_user_id: int | None = None

    async def _request(self, route: Route, **kwargs: Any) -> Any:
        if self._http is None:
            if self._login is None:
                self._login = asyncio.Lock()
            async with self._login:
                if self._http is None:
                    http = _http_client()
                    user = await http.static_login(self._token)
                    self.bot_user_id = int(user["id"])
                    self._http = http
        assert self._http is not None
        return await self._http.request(route, **kwargs)

    async def close(self) -> None:
        if self._http is not None:
            await self._http.close()
            self._http = None

    async def me(self) -> int:
        """The bot's own user id."""
        if self.bot_user_id is None:
            await self._request(Route("GET", "/users/@me"))
        assert self.bot_user_id is not None
        return self.bot_user_id

    async def guild(self, guild_id: int) -> dict[str, Any]:
        """Includes `owner_id` and every role."""
        return await self._request(Route("GET", "/guilds/{guild_id}", guild_id=guild_id))

    async def channels(self, guild_id: int) -> list[dict[str, Any]]:
        return await self._request(Route("GET", "/guilds/{guild_id}/channels", guild_id=guild_id))

    async def member(self, guild_id: int, user_id: int) -> dict[str, Any] | None:
        route = Route(
            "GET", "/guilds/{guild_id}/members/{user_id}", guild_id=guild_id, user_id=user_id
        )
        try:
            return await self._request(route)
        except discord.NotFound:
            return None

    async def members(
        self, guild_id: int, *, after: int = 0, limit: int = 1000
    ) -> list[dict[str, Any]]:
        """One page of members, in id order after `after`. Needs the Server Members intent."""
        route = Route("GET", "/guilds/{guild_id}/members", guild_id=guild_id)
        return await self._request(route, params={"limit": limit, "after": after})

    async def add_member_role(self, guild_id: int, user_id: int, role_id: int) -> None:
        route = Route(
            "PUT",
            "/guilds/{guild_id}/members/{user_id}/roles/{role_id}",
            guild_id=guild_id,
            user_id=user_id,
            role_id=role_id,
        )
        await self._request(route)

    async def remove_member_role(self, guild_id: int, user_id: int, role_id: int) -> None:
        route = Route(
            "DELETE",
            "/guilds/{guild_id}/members/{user_id}/roles/{role_id}",
            guild_id=guild_id,
            user_id=user_id,
            role_id=role_id,
        )
        try:
            await self._request(route)
        except discord.NotFound:
            return

    async def leave_guild(self, guild_id: int) -> None:
        route = Route("DELETE", "/users/@me/guilds/{guild_id}", guild_id=guild_id)
        try:
            await self._request(route)
        except discord.NotFound:
            return

    async def delete_role(self, guild_id: int, role_id: int) -> None:
        route = Route(
            "DELETE", "/guilds/{guild_id}/roles/{role_id}", guild_id=guild_id, role_id=role_id
        )
        try:
            await self._request(route)
        except discord.NotFound:
            return

    async def create_role(
        self, guild_id: int, *, name: str, permissions: int, hoist: bool = False
    ) -> dict[str, Any]:
        route = Route("POST", "/guilds/{guild_id}/roles", guild_id=guild_id)
        body = {"name": name, "permissions": str(permissions), "hoist": hoist}
        return await self._request(route, json=body)

    async def edit_role(self, guild_id: int, role_id: int, **fields: Any) -> dict[str, Any]:
        """`fields`: any of name and permissions."""
        if "permissions" in fields:
            fields["permissions"] = str(fields["permissions"])
        route = Route(
            "PATCH", "/guilds/{guild_id}/roles/{role_id}", guild_id=guild_id, role_id=role_id
        )
        return await self._request(route, json=fields)

    async def move_roles(self, guild_id: int, positions: list[dict[str, Any]]) -> None:
        await self._request(
            Route("PATCH", "/guilds/{guild_id}/roles", guild_id=guild_id), json=positions
        )

    async def create_channel(self, guild_id: int, **fields: Any) -> dict[str, Any]:
        """`fields`: name, type, and optionally parent_id, position and permission_overwrites."""
        route = Route("POST", "/guilds/{guild_id}/channels", guild_id=guild_id)
        return await self._request(route, json=fields)

    async def edit_channel(self, channel_id: int, **fields: Any) -> dict[str, Any]:
        """`fields`: any of name, parent_id and permission_overwrites, which replaces them all."""
        route = Route("PATCH", "/channels/{channel_id}", channel_id=channel_id)
        return await self._request(route, json=fields)

    async def move_channels(self, guild_id: int, positions: list[dict[str, Any]]) -> None:
        """At most one entry per call may change parent_id."""
        route = Route("PATCH", "/guilds/{guild_id}/channels", guild_id=guild_id)
        await self._request(route, json=positions)

    async def put_overwrite(
        self, channel_id: int, target_id: int, *, allow: int, deny: int, type: int
    ) -> None:
        route = Route(
            "PUT",
            "/channels/{channel_id}/permissions/{target_id}",
            channel_id=channel_id,
            target_id=target_id,
        )
        await self._request(route, json={"allow": str(allow), "deny": str(deny), "type": type})

    async def delete_overwrite(self, channel_id: int, target_id: int) -> None:
        route = Route(
            "DELETE",
            "/channels/{channel_id}/permissions/{target_id}",
            channel_id=channel_id,
            target_id=target_id,
        )
        await self._request(route)

    async def message_exists(self, channel_id: int, message_id: int) -> bool:
        route = Route(
            "GET",
            "/channels/{channel_id}/messages/{message_id}",
            channel_id=channel_id,
            message_id=message_id,
        )
        try:
            await self._request(route)
        except (discord.NotFound, discord.Forbidden):
            return False
        return True

    async def send_message(self, channel_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        route = Route("POST", "/channels/{channel_id}/messages", channel_id=channel_id)
        return await self._request(route, json=payload)

    async def edit_interaction_reply(self, token: str, payload: dict[str, Any]) -> None:
        """Edits the original reply to an interaction. Interaction tokens are bearer secrets for
        15 minutes: never log them, or the URLs that contain them."""
        application_id = get_settings().discord_application_id
        url = f"https://discord.com/api/v10/webhooks/{application_id}/{token}/messages/@original"
        try:
            async with httpx2.AsyncClient(timeout=10) as client:
                response = await client.patch(url, json=payload)
        except httpx2.HTTPError as exc:
            # `from None`: the original exception can carry the URL.
            raise InteractionReplyError(type(exc).__name__) from None
        if response.status_code >= 400:
            raise InteractionReplyError(f"HTTP {response.status_code}")


class InteractionReplyError(Exception):
    """Carries only a short reason, so the token-bearing URL never reaches a log."""

    def __init__(self, reason: str) -> None:
        super().__init__(f"editing the interaction reply failed: {reason}")


def _http_client() -> HTTPClient:
    return HTTPClient(asyncio.get_running_loop(), max_ratelimit_timeout=MAX_RATE_LIMIT_WAIT)


_rest: DiscordRest | None = None


def get_rest() -> DiscordRest:
    global _rest
    if _rest is None:
        _rest = DiscordRest(get_settings().discord_bot_token)
    return _rest


async def close_rest() -> None:
    global _rest
    if _rest is not None:
        await _rest.close()
        _rest = None
