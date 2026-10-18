"""Answers to slash commands and button clicks. Nothing here changes NEXUS data; the only
writes are to the Discord tables (sync marks and build status)."""

import logging
import time
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.core.discord import build as discord_build
from app.core.discord.build import Target, claim_build
from app.core.discord.eligibility import is_eligible
from app.core.discord.layout import event_name_with_division
from app.core.discord.links import link_for_guild, user_label
from app.core.discord.marks import mark_full, mark_member
from app.core.discord.previews import PreviewExpired, discord_summary, sign, verify
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
from app.services.discord import rest as discord_rest
from app.services.discord.interactions import (
    APPLICATION_COMMAND,
    DANGER_STYLE,
    MESSAGE_COMPONENT,
    PRIMARY_STYLE,
    SECONDARY_STYLE,
    button,
    deferred_reply,
    link_button,
    reply,
    update,
)
from app.services.discord.interactions import row as action_row

log = logging.getLogger(__name__)

STAFF_COMMANDS = {"sync", "setup", "reset"}
VERIFY_COOLDOWN_SECONDS = 10
PROGRESS_INTERVAL_SECONDS = 3

# (guild id, Discord user id) -> when they last clicked Verify. Per worker, which is enough to
# stop a burst of clicks from writing a mark each.
_verify_clicks: dict[tuple[int, int], float] = {}

# Runs a coroutine after the response is sent: FastAPI's BackgroundTasks.add_task.
Schedule = Callable[..., None]


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


def handle(db: Session, payload: dict[str, Any], schedule: Schedule) -> dict[str, Any]:
    guild_id = payload.get("guild_id")
    member = payload.get("member")
    if guild_id is None or member is None:
        return reply("lobot's commands work only inside servers.")
    discord_user_id = str(member["user"]["id"])
    custom_id = payload.get("data", {}).get("custom_id", "")

    # Answered before any database query: verified members click it by habit.
    if payload["type"] == MESSAGE_COMPONENT and custom_id.startswith("nexus:verify:"):
        if custom_id.removeprefix("nexus:verify:") in member.get("roles", []):
            return reply("You're already verified.")
        wait = _verify_cooldown(int(guild_id), int(discord_user_id))
        if wait:
            return reply(f"Try again in {wait} s.")

    link = link_for_guild(db, int(guild_id))
    problem = _unusable(link)
    if problem is not None:
        return reply(problem)
    assert link is not None

    if payload["type"] == MESSAGE_COMPONENT:
        if custom_id.startswith("nexus:verify:"):
            return _verify(db, link, discord_user_id)
        if custom_id == "nexus:cancel":
            return update("Cancelled. Nothing changed.")
        if custom_id.startswith("nexus:go:"):
            token = custom_id.removeprefix("nexus:go:")
            return _confirm(db, link, discord_user_id, token, payload, schedule)
        return reply("This button doesn't do anything any more.")
    if payload["type"] != APPLICATION_COMMAND:
        return reply("lobot doesn't know how to answer that.")

    data = payload["data"]
    name = data["name"]
    if name == "link":
        return reply("Link your Discord account to NEXUS:", components=_link_row())
    if name == "whoami":
        return _whoami(db, link, discord_user_id)
    if name in STAFF_COMMANDS:
        options = {o["name"]: o.get("value") for o in data.get("options", [])}
        return _staff_command(db, link, discord_user_id, name, options, payload, schedule)
    return reply("lobot doesn't know that command.")


def _verify_cooldown(guild_id: int, discord_user_id: int) -> int:
    """Seconds before this person may click Verify again; 0 means go ahead, and records the click."""
    now = time.monotonic()
    last = _verify_clicks.get((guild_id, discord_user_id))
    if last is not None and now - last < VERIFY_COOLDOWN_SECONDS:
        return int(VERIFY_COOLDOWN_SECONDS - (now - last)) + 1
    _verify_clicks[(guild_id, discord_user_id)] = now
    return 0


def _verify(db: Session, link: DiscordGuildLink, discord_user_id: str) -> dict[str, Any]:
    user = _nexus_user(db, discord_user_id)
    if user is None:
        return reply(
            "Link your Discord account to NEXUS first. Once it's linked, you're verified "
            "automatically.",
            components=_link_row(),
        )
    if not is_eligible(db, link, user):
        where = f"{tournament_display_name(link.tournament)} ({link.track.name})"
        return reply(
            f"Your NEXUS account ({user_label(user)}) isn't on staff for {where}. "
            "Contact the tournament director."
        )
    mark_member(db, link.id, int(discord_user_id))
    db.commit()
    return reply("You're verified. Your channels will appear in a few seconds.")


def _staff_refusal(
    db: Session, link: DiscordGuildLink, discord_user_id: str
) -> dict[str, Any] | None:
    user = _nexus_user(db, discord_user_id)
    if user is None:
        return reply("Link your NEXUS account first.", components=_link_row())
    if not has_permission(user, link.tournament_id, MANAGE_DISCORD, db):
        return reply("You need the Manage Discord permission in NEXUS to run this.")
    return None


def _staff_command(
    db: Session,
    link: DiscordGuildLink,
    discord_user_id: str,
    name: str,
    options: dict[str, Any],
    payload: dict[str, Any],
    schedule: Schedule,
) -> dict[str, Any]:
    refusal = _staff_refusal(db, link, discord_user_id)
    if refusal is not None:
        return refusal
    if name == "reset" and len(options) > 1:
        return reply("Pick a role or a channel to reset, not both.")
    if name in ("sync", "reset") and link.built_at is None:
        return reply("Run /setup first.")
    if name == "sync":
        mark_full(db, link.id)
        db.commit()
        message = (
            "Sync queued. Members' roles and missing roles and channels catch up in a few seconds."
        )
        if link.last_sync_error:
            message += f"\nThe last sync failed: {link.last_sync_error}"
        elif link.last_sync_warning:
            message += f"\nThe last sync finished with a warning: {link.last_sync_warning}"
        return reply(message)

    target = None
    if "role" in options:
        target = Target("role", int(options["role"]))
    elif "channel" in options:
        target = Target("channel", int(options["channel"]))
    title = f"/{name}" if target is None else f"/reset {target.kind}"
    schedule(
        _send_preview,
        link.id,
        name == "reset",
        target,
        f"d{discord_user_id}",
        title,
        payload["token"],
    )
    return deferred_reply()


def settings_url(tournament_id: int) -> str:
    return frontend_redirect(f"/dashboard/tournaments/{tournament_id}/settings/discord")


async def _edit(token: str, payload: dict[str, Any]) -> None:
    payload.setdefault("allowed_mentions", {"parse": []})
    try:
        await discord_rest.get_rest().edit_interaction_reply(token, payload)
    except discord_rest.InteractionReplyError as exc:
        log.warning("%s", exc)


async def _send_preview(
    link_id: int, reset: bool, target: Target | None, actor: str, title: str, token: str
) -> None:
    try:
        plan, snapshot, _ = await discord_build.prepare(
            link_id, reset=reset, target=target, session_scope=discord_build.default_session_scope
        )
    except Exception:
        log.exception("Couldn't preview a build for link %s", link_id)
        await _edit(token, {"content": "lobot couldn't read this server. Try again."})
        return
    if plan.empty and not plan.warnings:
        await _edit(token, {"content": "Nothing to change. This server matches NEXUS."})
        return
    content = discord_summary(plan, f"Preview of {title}", settings_url(snapshot.tournament_id))
    buttons = [button("Cancel", "nexus:cancel", SECONDARY_STYLE)]
    if not plan.blocked and not plan.empty:
        custom_id = "nexus:go:" + sign(link_id, reset, target, actor)
        buttons.insert(0, button("Confirm", custom_id, DANGER_STYLE if reset else PRIMARY_STYLE))
    await _edit(token, {"content": content, "components": [action_row(*buttons)]})


def _confirm(
    db: Session,
    link: DiscordGuildLink,
    discord_user_id: str,
    token: str,
    payload: dict[str, Any],
    schedule: Schedule,
) -> dict[str, Any]:
    try:
        preview = verify(token)
    except PreviewExpired:
        return update("This preview expired. Run the command again.")
    if preview is None or preview.link_id != link.id:
        return update("This preview isn't valid. Run the command again.")
    if preview.actor != f"d{discord_user_id}":
        return reply("Only the person who ran the command can confirm it.")
    refusal = _staff_refusal(db, link, discord_user_id)
    if refusal is not None:
        return refusal
    if not claim_build(db, link.id):
        return update("A build is already running for this server. Try again when it finishes.")
    schedule(_run_and_report, link.id, preview.reset, preview.target, payload["token"])
    return update("Building… This can take a few minutes.")


async def _run_and_report(link_id: int, reset: bool, target: Target | None, token: str) -> None:
    last = 0.0

    async def progress(done: int, total: int) -> None:
        nonlocal last
        now = time.monotonic()
        if done < total and now - last >= PROGRESS_INTERVAL_SECONDS:
            last = now
            await _edit(token, {"content": f"Building… {done} of {total} steps done."})

    error = await discord_build.run_build(
        link_id,
        reset=reset,
        target=target,
        session_scope=discord_build.default_session_scope,
        progress=progress,
    )
    if error:
        content = f"The build stopped: {error}\nRun the command again to pick up where it left off."
    else:
        content = "Done. Members' roles will update over the next few seconds."
    await _edit(token, {"content": content[:2000]})


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
