"""Linking Discord servers to tracks: the install's checks, and telling the leader to leave."""

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.tournament.permissions import MANAGE_DISCORD, MANAGE_TOURNAMENT, has_permission
from app.models.discord import DiscordGuildLink
from app.models.models import OAuthIdentity, OAuthProvider, Tournament, TournamentTrack, User

CHANNEL = "discord_sync"


def user_label(user: User) -> str:
    name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return name or user.email


def link_for_track(db: Session, track_id: int) -> DiscordGuildLink | None:
    return db.query(DiscordGuildLink).filter(DiscordGuildLink.track_id == track_id).first()


def link_for_guild(db: Session, guild_id: int) -> DiscordGuildLink | None:
    return db.query(DiscordGuildLink).filter(DiscordGuildLink.guild_id == guild_id).first()


def require_track_installable(db: Session, track: TournamentTrack) -> None:
    if track.is_archived:
        raise HTTPException(status.HTTP_409_CONFLICT, "This track is being deleted")
    link = link_for_track(db, track.id)
    if link is not None and link.bot_removed_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This track already has a Discord server")


def notify_leave(db: Session, guild_id: int) -> None:
    """Asks the leader to make the bot leave this server. Delivered when the transaction commits."""
    db.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {"channel": CHANNEL, "payload": f"leave:{guild_id}"},
    )


@dataclass
class InstallRefused(Exception):
    """`code` goes back to the frontend; `owner` names the server owner when that's the reason."""

    code: str
    owner: str | None = None


def check_install(
    db: Session,
    *,
    installer: User,
    tournament: Tournament,
    track: TournamentTrack | None,
    guild: dict[str, Any],
) -> None:
    """Raises InstallRefused unless this server may be linked to this track. `guild` is the
    object from Discord's token response, never the redirect's guild_id hint."""
    if not has_permission(installer, tournament.id, MANAGE_DISCORD, db):
        raise InstallRefused("no_permission")
    if tournament.is_archived:
        raise InstallRefused("tournament_archived")
    if track is None or track.is_archived:
        raise InstallRefused("track_unavailable")

    guild_id = int(guild["id"])
    by_guild = link_for_guild(db, guild_id)
    if by_guild is not None and by_guild.track_id != track.id:
        raise InstallRefused("guild_linked_elsewhere")
    by_track = link_for_track(db, track.id)
    if by_track is not None and by_track.guild_id != guild_id:
        raise InstallRefused("track_linked_elsewhere")

    identity = (
        db.query(OAuthIdentity)
        .filter(
            OAuthIdentity.provider == OAuthProvider.discord,
            OAuthIdentity.provider_account_id == str(guild["owner_id"]),
        )
        .first()
    )
    if identity is None:
        raise InstallRefused("owner_not_linked")
    if not has_permission(identity.user, tournament.id, MANAGE_TOURNAMENT, db):
        raise InstallRefused("owner_lacks_permission", owner=user_label(identity.user))
