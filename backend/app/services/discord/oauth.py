"""Discord OAuth2: the authorize URL, the code exchange and the token owner's profile."""

from typing import Any
from urllib.parse import urlencode

import httpx2

from app.core.config import get_settings

API_BASE = "https://discord.com/api/v10"
AUTHORIZE_URL = "https://discord.com/oauth2/authorize"


class DiscordOAuthError(Exception):
    pass


def authorize_url(*, redirect_uri: str, state: str, scopes: list[str], **extra: str) -> str:
    params = {
        "client_id": get_settings().discord_application_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": " ".join(scopes),
        "state": state,
        **extra,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def exchange_code(code: str, redirect_uri: str) -> dict[str, Any]:
    """The full token response, including `guild` for a bot install with a user scope."""
    settings = get_settings()
    return _request(
        "POST",
        "/oauth2/token",
        data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
        auth=(settings.discord_application_id, settings.discord_client_secret),
    )


def fetch_current_user(access_token: str) -> dict[str, Any]:
    return _request("GET", "/users/@me", headers={"Authorization": f"Bearer {access_token}"})


def _request(method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    """Every call in this module goes through here, so tests patch this one function."""
    try:
        response = httpx2.request(method, API_BASE + path, timeout=10, **kwargs)
    except httpx2.HTTPError as exc:
        raise DiscordOAuthError(f"{method} {path} failed: {type(exc).__name__}") from exc
    if response.status_code >= 400:
        try:
            reason = response.json().get("error", "")
        except ValueError:
            reason = ""
        raise DiscordOAuthError(f"{method} {path} failed: HTTP {response.status_code} {reason}")
    try:
        return response.json()
    except ValueError as exc:
        raise DiscordOAuthError(f"{method} {path} returned no JSON") from exc
