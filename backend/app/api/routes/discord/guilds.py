"""Linking a Discord server to a track: "Add to Discord", its callback, and the per-track
settings. The install is a browser navigation, so its failures redirect instead of returning
JSON."""

import logging
import secrets
from functools import partial
from typing import Any

import anyio
import discord
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Cookie,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.auth import get_active_session
from app.core.config import get_settings
from app.core.discord import build as discord_build
from app.core.discord.deps import require_discord_enabled
from app.core.discord.links import (
    InstallRefused,
    check_install,
    link_for_guild,
    link_for_track,
    notify_leave,
    require_track_installable,
    user_label,
)
from app.core.discord.marks import mark_full
from app.core.discord.previews import PreviewExpired, sign, verify
from app.core.oauth import frontend_redirect, with_query
from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.audit import (
    DISCORD_SERVER_LINKED,
    DISCORD_SERVER_UNLINKED,
    DISCORD_SETTINGS_UPDATED,
    log_action,
)
from app.core.tournament.permissions import MANAGE_DISCORD, require_permission
from app.db.session import get_db
from app.models.discord import CategoryGrouping, DiscordGuildLink
from app.models.models import Tournament, TournamentTrack, User
from app.schemas.discord import (
    DiscordBuildPreview,
    DiscordBuildRequest,
    DiscordLinkResponse,
    DiscordLinkUpdate,
    DiscordPreviewGroup,
    DiscordTrackStatus,
)
from app.services.discord import oauth as discord_oauth
from app.services.discord import rest as discord_rest
from app.services.discord.oauth import DiscordOAuthError

log = logging.getLogger(__name__)

router = APIRouter(tags=["discord"], dependencies=[Depends(require_discord_enabled)])

ADMINISTRATOR = 1 << 3
SESSION_KEY = "discord_install"


def _settings_path(tournament_id: int) -> str:
    return f"/dashboard/tournaments/{tournament_id}/settings/discord"


def _link_response(link: DiscordGuildLink) -> DiscordLinkResponse:
    response = DiscordLinkResponse.model_validate(link)
    response.installed_by_name = user_label(link.installed_by) if link.installed_by else None
    return response


def _status(track_id: int, link: DiscordGuildLink | None) -> DiscordTrackStatus:
    return DiscordTrackStatus(track_id=track_id, link=_link_response(link) if link else None)


def _scoped_link(db: Session, tournament_id: int, track_id: int) -> DiscordGuildLink:
    get_scoped_or_404(db, TournamentTrack, track_id, tournament_id, "Track")
    link = link_for_track(db, track_id)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No Discord server is linked to this track")
    return link


@router.get("/tournaments/{tournament_id}/tracks/{track_id}/discord/install/")
def start_install(
    request: Request,
    tournament_id: int,
    track_id: int,
    merge_divisions: bool = False,
    category_grouping: CategoryGrouping = "building",
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_DISCORD)),
):
    """Redirects to Discord to add lobot to a server and link it to this track."""
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    track = get_scoped_or_404(db, TournamentTrack, track_id, tournament_id, "Track")
    require_track_installable(db, track)

    state = secrets.token_urlsafe(32)
    request.session.clear()
    request.session[SESSION_KEY] = {
        "state": state,
        "user_id": current_user.id,
        "tournament_id": tournament_id,
        "track_id": track_id,
        "merge_divisions": merge_divisions,
        "category_grouping": category_grouping,
    }
    # `identify` is what makes Discord's token response carry the `guild` object.
    url = discord_oauth.authorize_url(
        redirect_uri=get_settings().discord_install_redirect_uri,
        state=state,
        scopes=["bot", "applications.commands", "identify"],
        permissions=str(ADMINISTRATOR),
    )
    return RedirectResponse(url, status_code=302)


def _leave_now(db: Session, guild_id: int) -> None:
    """Makes the bot leave before the redirect, so a quick retry finds the bot gone. A failed
    call falls back to asking the leader."""
    try:
        anyio.from_thread.run(discord_rest.get_rest().leave_guild, guild_id)
    except Exception:
        log.exception("Couldn't leave server %s; asking the leader to", guild_id)
        notify_leave(db, guild_id)
        db.commit()


@router.get("/discord/install/callback/", include_in_schema=False)
def finish_install(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    pending: dict[str, Any] | None = request.session.pop(SESSION_KEY, None)
    request.session.clear()
    if pending is None:
        return RedirectResponse(frontend_redirect("/dashboard"), status_code=302)
    tournament_id: int = pending["tournament_id"]
    dest = _settings_path(tournament_id)

    def bounce(**params: str) -> RedirectResponse:
        return RedirectResponse(frontend_redirect(with_query(dest, **params)), status_code=302)

    if error:
        if error == "access_denied":
            return bounce(error="discord_cancelled")
        log.warning("Discord install refused by Discord: %s", error)
        return bounce(error="discord_failed")
    if not (code and state and secrets.compare_digest(state, pending["state"])):
        log.warning("Discord install callback had no code or a mismatched state")
        return bounce(error="discord_failed")
    session_row = get_active_session(db, access_token) if access_token else None
    if session_row is None or session_row.user_id != pending["user_id"]:
        log.warning("Discord install callback came back to a different NEXUS session")
        return bounce(error="discord_failed")

    try:
        token = discord_oauth.exchange_code(code, get_settings().discord_install_redirect_uri)
    except DiscordOAuthError as exc:
        log.warning("Discord install code exchange failed: %s", exc)
        return bounce(error="discord_failed")
    try:
        guild = token["guild"]
        guild_id = int(guild["id"])
    except (KeyError, TypeError, ValueError):
        # Without the token's guild there's nothing trustworthy to leave; the sweep covers it.
        log.warning("Discord install token response had no guild (scopes: %s)", token.get("scope"))
        return bounce(error="discord_no_guild")

    tournament = db.get(Tournament, tournament_id)
    track = db.get(TournamentTrack, pending["track_id"])
    if track is not None and track.tournament_id != tournament_id:
        track = None
    assert tournament is not None
    try:
        check_install(
            db, installer=session_row.user, tournament=tournament, track=track, guild=guild
        )
    except InstallRefused as refused:
        log.info("Discord install refused (%s) for server %s", refused.code, guild_id)
        # Never leave a server another track is linked to.
        if link_for_guild(db, guild_id) is None:
            _leave_now(db, guild_id)
        params = {"error": refused.code}
        if refused.owner:
            params["owner"] = refused.owner
        return bounce(**params)
    assert track is not None

    link = link_for_track(db, track.id)
    readded = link is not None
    if link is None:
        link = DiscordGuildLink(tournament_id=tournament_id, track_id=track.id, guild_id=guild_id)
        db.add(link)
    link.guild_name = guild.get("name")
    link.installed_by_user_id = session_row.user_id
    link.merge_divisions = pending["merge_divisions"]
    link.category_grouping = pending["category_grouping"]
    link.bot_removed_at = None
    db.flush()
    if link.built_at is not None:
        # Catches up on whatever changed while the bot was out.
        mark_full(db, link.id)
    extra: dict[str, Any] = {
        "track_name": track.name,
        "guild_id": str(guild_id),
        "guild_name": link.guild_name,
    }
    if readded:
        extra["readded"] = True
    log_action(
        db, tournament_id, session_row.user_id, DISCORD_SERVER_LINKED, "track", track.id, extra
    )
    db.commit()
    return bounce(linked=str(track.id))


@router.get(
    "/tournaments/{tournament_id}/tracks/{track_id}/discord/",
    response_model=DiscordTrackStatus,
)
def get_track_discord(
    tournament_id: int,
    track_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission(MANAGE_DISCORD)),
):
    """The Discord server linked to a track, if any, with its build and sync status."""
    get_scoped_or_404(db, TournamentTrack, track_id, tournament_id, "Track")
    return _status(track_id, link_for_track(db, track_id))


@router.patch(
    "/tournaments/{tournament_id}/tracks/{track_id}/discord/",
    response_model=DiscordTrackStatus,
)
def update_track_discord(
    tournament_id: int,
    track_id: int,
    payload: DiscordLinkUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_DISCORD)),
):
    """Changes the server's layout settings. They take effect on the next reset."""
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    link = _scoped_link(db, tournament_id, track_id)

    changes = []
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is None or getattr(link, field) == value:
            continue
        changes.append({"field": field, "old": getattr(link, field), "new": value})
        setattr(link, field, value)
    if changes:
        log_action(
            db,
            tournament_id,
            current_user.id,
            DISCORD_SETTINGS_UPDATED,
            "track",
            track_id,
            {"track_name": link.track.name, "changes": changes},
        )
        db.commit()
    return _status(track_id, link)


@router.delete(
    "/tournaments/{tournament_id}/tracks/{track_id}/discord/",
    status_code=status.HTTP_204_NO_CONTENT,
)
def unlink_track_discord(
    tournament_id: int,
    track_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_DISCORD)),
):
    """Unlinks the server and makes lobot leave it. The server's roles and channels stay."""
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    link = _scoped_link(db, tournament_id, track_id)

    log_action(
        db,
        tournament_id,
        current_user.id,
        DISCORD_SERVER_UNLINKED,
        "track",
        track_id,
        {
            "track_name": link.track.name,
            "guild_id": str(link.guild_id),
            "guild_name": link.guild_name,
        },
    )
    notify_leave(db, link.guild_id)
    db.delete(link)
    db.commit()


@router.post(
    "/tournaments/{tournament_id}/tracks/{track_id}/discord/build/",
    response_model=DiscordBuildPreview | DiscordTrackStatus,
    responses={202: {"model": DiscordTrackStatus, "description": "The build started"}},
)
def build_track_discord(
    tournament_id: int,
    track_id: int,
    payload: DiscordBuildRequest,
    response: Response,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_DISCORD)),
):
    """Builds the linked server, or with `reset` puts NEXUS's defaults back over hand edits.

    Call it first with `dry_run` (the default) for a preview of exactly what would change, then
    again with `dry_run: false` and the preview's `preview_token` within 10 minutes to run it.
    The build runs in the background; its outcome lands on the link's `last_build_*` fields.
    """
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    link = _scoped_link(db, tournament_id, track_id)
    if link.track.is_archived:
        raise HTTPException(status.HTTP_409_CONFLICT, "This track is being deleted")
    if link.bot_removed_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "lobot was removed from this server. Add it back first."
        )
    if payload.reset and link.built_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Build the server before resetting it")

    if payload.dry_run:
        try:
            plan, _, _ = anyio.from_thread.run(
                partial(
                    discord_build.prepare,
                    link.id,
                    reset=payload.reset,
                    target=None,
                    session_scope=discord_build.default_session_scope,
                )
            )
        except discord.HTTPException as exc:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, f"Couldn't read the Discord server: {exc.text}"
            ) from None
        runnable = not plan.blocked and not plan.empty
        return DiscordBuildPreview(
            groups=[DiscordPreviewGroup(title=t, items=items) for t, items in plan.groups()],
            warnings=plan.warnings,
            blockers=plan.blockers,
            preview_token=sign(link.id, payload.reset, None, f"u{current_user.id}")
            if runnable
            else None,
        )

    if not payload.preview_token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Preview the build first")
    try:
        preview = verify(payload.preview_token)
    except PreviewExpired:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This preview expired. Preview again."
        ) from None
    if (
        preview is None
        or preview.link_id != link.id
        or preview.reset != payload.reset
        or preview.target is not None
        or preview.actor != f"u{current_user.id}"
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This preview isn't valid. Preview again.")
    if not discord_build.claim_build(db, link.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "A build is already running for this server")
    background_tasks.add_task(
        discord_build.run_build,
        link.id,
        reset=payload.reset,
        target=None,
        session_scope=discord_build.default_session_scope,
    )
    response.status_code = status.HTTP_202_ACCEPTED
    db.refresh(link)
    return _status(track_id, link)
