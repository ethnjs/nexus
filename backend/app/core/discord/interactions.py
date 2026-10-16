"""Answers to slash commands and button clicks. Nothing here changes NEXUS data."""

from typing import Any

from sqlalchemy.orm import Session

from app.core.discord.layout import event_name_with_division
from app.core.discord.links import link_for_guild, user_label
from app.core.oauth import frontend_redirect
from app.core.tournament import tournament_display_name
from app.core.tournament.permissions import MANAGE_DISCORD, has_permission
from app.models.discord import DiscordGuildLink
from app.models.models import (
    OAuthIdentity,
    OAuthProvider,
    TournamentMembership,
    TournamentTrackAssignment,
    User,
)
from app.services.discord.interactions import (
    APPLICATION_COMMAND,
    MESSAGE_COMPONENT,
    link_button,
    reply,
)

STAFF_COMMANDS = {"sync", "setup", "reset"}


def _link_row() -> list[dict[str, Any]]:
    return [link_button("Link your NEXUS account", frontend_redirect("/connect/discord"))]


def _nexus_user(db: Session, discord_user_id: str) -> User | None:
    identity = (
        db.query(OAuthIdentity)
        .filter(
            OAuthIdentity.provider == OAuthProvider.discord,
            OAuthIdentity.provider_account_id == discord_user_id,
        )
        .first()
    )
    return identity.user if identity else None


def _unusable(link: DiscordGuildLink | None) -> str | None:
    """Why commands can't run in this server, if they can't."""
    if link is None:
        return "This server isn't linked to a NEXUS track."
    if link.tournament.is_archived:
        return "This tournament is archived."
    if link.track.is_archived:
        return "This track is being deleted."
    return None


def handle(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    guild_id = payload.get("guild_id")
    member = payload.get("member")
    if guild_id is None or member is None:
        return reply("NEXUS commands work only inside servers.")
    link = link_for_guild(db, int(guild_id))
    problem = _unusable(link)
    if problem is not None:
        return reply(problem)
    assert link is not None
    discord_user_id = str(member["user"]["id"])

    if payload["type"] == MESSAGE_COMPONENT:
        return reply("This button doesn't do anything any more.")
    if payload["type"] != APPLICATION_COMMAND:
        return reply("NEXUS doesn't know how to answer that.")

    data = payload["data"]
    name = data["name"]
    if name == "link":
        return reply("Link your Discord account to NEXUS:", components=_link_row())
    if name == "whoami":
        return _whoami(db, link, discord_user_id)
    if name in STAFF_COMMANDS:
        options = {o["name"]: o.get("value") for o in data.get("options", [])}
        return _staff_command(db, link, discord_user_id, name, options)
    return reply("NEXUS doesn't know that command.")


def _staff_command(
    db: Session,
    link: DiscordGuildLink,
    discord_user_id: str,
    name: str,
    options: dict[str, Any],
) -> dict[str, Any]:
    user = _nexus_user(db, discord_user_id)
    if user is None:
        return reply("Link your NEXUS account first.", components=_link_row())
    if not has_permission(user, link.tournament_id, MANAGE_DISCORD, db):
        return reply("You need the Manage Discord permission in NEXUS to run this.")
    if name == "reset" and len(options) > 1:
        return reply("Pick a role or a channel to reset, not both.")
    if name in ("sync", "reset") and link.built_at is None:
        return reply("Run /setup first.")
    return reply(f"/{name} isn't available yet.")


def _whoami(db: Session, link: DiscordGuildLink, discord_user_id: str) -> dict[str, Any]:
    user = _nexus_user(db, discord_user_id)
    if user is None:
        return reply("Your Discord account isn't linked to NEXUS.", components=_link_row())
    tournament = link.tournament
    track = link.track
    where = f"{tournament_display_name(tournament)} ({track.name})"
    lines = [f"You're linked to NEXUS as **{user_label(user)}**."]
    if tournament.owner_id == user.id:
        lines.append(f"You own {where}.")

    membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == user.id,
            TournamentMembership.tournament_id == tournament.id,
        )
        .first()
    )
    rows = [
        row
        for row in (membership.track_assignments if membership else [])
        if row.is_tournament_wide or row.tournament_track_id == track.id
    ]
    if not rows:
        if tournament.owner_id != user.id:
            lines.append(f"You aren't on staff for {where}.")
        return reply("\n".join(lines))

    lines.append(f"**Roles** in {where}: {_role_summary(rows)}")
    events = _event_lines(rows)
    if events:
        lines.append("**Events:**")
        lines.extend(events)
    return reply("\n".join(lines))


def _role_summary(rows: list[TournamentTrackAssignment]) -> str:
    wide = {row.role_id for row in rows if row.is_tournament_wide}
    roles = sorted(
        {row.role_id: row.role for row in rows}.values(), key=lambda r: (r.rank, r.label)
    )
    return ", ".join(
        f"{role.label} (tournament-wide)" if role.id in wide else role.label for role in roles
    )


def _event_lines(rows: list[TournamentTrackAssignment]) -> list[str]:
    events = [
        (event, row.tournament_shift) for row in rows if (event := row.tournament_event) is not None
    ]
    events.sort(
        key=lambda pair: (
            pair[1].start.timestamp() if pair[1] else 0.0,
            event_name_with_division(pair[0]),
        )
    )
    lines = []
    for event, shift in events:
        line = f"• {event_name_with_division(event)}"
        if shift is not None:
            # Discord renders <t:...> in each reader's own time zone.
            start, end = int(shift.start.timestamp()), int(shift.end.timestamp())
            line += f", {shift.label}: <t:{start}:f> to <t:{end}:t>"
        lines.append(line)
    return lines
