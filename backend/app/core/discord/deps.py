from fastapi import HTTPException, status

from app.core.config import discord_enabled


def discord_is_enabled() -> bool:
    """`discord_enabled()` as a dependency, so tests can turn it on like the others."""
    return discord_enabled()


def require_discord_enabled() -> None:
    if not discord_enabled():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
