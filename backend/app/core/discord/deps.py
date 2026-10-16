from fastapi import HTTPException, status

from app.core.config import discord_enabled


def require_discord_enabled() -> None:
    if not discord_enabled():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
