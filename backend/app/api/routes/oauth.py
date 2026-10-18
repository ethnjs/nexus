"""OAuth start + callback for Google (sign-in and linking) and Discord (linking only).
Browser navigations, so failures redirect instead of returning JSON. Provider access
tokens are used once and never stored."""

import secrets

from authlib.integrations.base_client import OAuthError
from fastapi import APIRouter, Cookie, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import create_session, get_active_session, get_client_ip, set_auth_cookie
from app.core.config import get_settings
from app.core.discord.deps import require_discord_enabled
from app.core.discord.marks import mark_account_everywhere
from app.core.oauth import (
    AccountExists,
    AccountInactive,
    IdentityLinkError,
    email_and_sub,
    frontend_redirect,
    get_google_oauth,
    is_discord_link_configured,
    is_google_configured,
    link_identity,
    resolve_google_login,
    safe_redirect_path,
    with_query,
    with_redirect,
)
from app.core.profile_status import is_onboarding_complete
from app.db.session import get_db
from app.models.models import OAuthIdentity, OAuthProvider
from app.services.discord import oauth as discord_oauth
from app.services.email_service import send_identity_linked_notice

router = APIRouter(tags=["auth"])


def _bounce(request: Request, path: str, *, raw_token: str | None = None) -> RedirectResponse:
    request.session.clear()
    response = RedirectResponse(frontend_redirect(path), status_code=302)
    if raw_token is not None:
        set_auth_cookie(response, raw_token)
    return response


def _error_path(intent: str | None, code: str) -> str:
    base = "/settings/security" if intent == "link" else "/sign-in"
    return f"{base}?error={code}"


@router.get("/auth/oauth/google/start/")
async def google_start(
    request: Request,
    intent: str = "login",
    redirect: str | None = None,
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    if intent not in ("login", "link"):
        intent = "login"
    if not is_google_configured():
        return RedirectResponse(
            frontend_redirect("/sign-in?error=google_unavailable"), status_code=302
        )

    if intent == "link":
        session_row = get_active_session(db, access_token) if access_token else None
        if session_row is None:
            return RedirectResponse(
                frontend_redirect("/sign-in?redirect=/settings/security"),
                status_code=302,
            )
        request.session["oauth_link_user_id"] = session_row.user_id

    request.session["oauth_intent"] = intent
    request.session["oauth_redirect"] = safe_redirect_path(redirect)
    return await get_google_oauth().google.authorize_redirect(
        request,
        get_settings().google_oauth_redirect_uri,
        prompt="select_account",
    )


@router.get("/auth/oauth/google/callback/")
async def google_callback(
    request: Request,
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    intent = request.session.get("oauth_intent")
    saved_redirect = request.session.get("oauth_redirect")
    link_user_id = request.session.get("oauth_link_user_id")

    provider_error = request.query_params.get("error")
    if provider_error:
        code = "google_cancelled" if provider_error == "access_denied" else "google_failed"
        return _bounce(request, _error_path(intent, code))

    try:
        token = await get_google_oauth().google.authorize_access_token(request)
    except OAuthError as exc:
        code = "google_cancelled" if exc.error == "access_denied" else "google_failed"
        return _bounce(request, _error_path(intent, code))

    claims = token.get("userinfo") or {}

    if intent == "link":
        session_row = get_active_session(db, access_token) if access_token else None
        if session_row is None or session_row.user_id != link_user_id:
            return _bounce(request, _error_path("link", "google_failed"))
        try:
            email, sub = email_and_sub(claims)
            identity = link_identity(db, session_row.user, OAuthProvider.google, sub, email=email)
        except (IdentityLinkError, ValueError) as exc:
            code = exc.code if isinstance(exc, IdentityLinkError) else "google_failed"
            return _bounce(request, _error_path("link", code))
        await send_identity_linked_notice(session_row.user.email, identity.email_at_provider)
        return _bounce(request, "/settings/security?linked=google")

    try:
        user, _created = resolve_google_login(db, claims)
    except AccountExists:
        return _bounce(request, _error_path("login", "google_account_exists"))
    except AccountInactive:
        return _bounce(request, _error_path("login", "google_account_inactive"))
    except (ValueError, IntegrityError):
        return _bounce(request, _error_path("login", "google_failed"))

    raw_token = create_session(
        db,
        user.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=get_client_ip(request),
    )
    if is_onboarding_complete(user, db=db):
        dest = saved_redirect or "/dashboard"
    else:
        dest = with_redirect("/onboarding", saved_redirect)
    return _bounce(request, dest, raw_token=raw_token)


@router.get("/auth/oauth/discord/start/", dependencies=[Depends(require_discord_enabled)])
def discord_start(
    request: Request,
    redirect: str | None = None,
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    dest = safe_redirect_path(redirect) or "/connect/discord"
    session_row = get_active_session(db, access_token) if access_token else None
    if session_row is None:
        return RedirectResponse(frontend_redirect(with_redirect("/sign-in", dest)), status_code=302)
    if not is_discord_link_configured():
        return RedirectResponse(
            frontend_redirect(with_query(dest, error="discord_unavailable")), status_code=302
        )

    state = secrets.token_urlsafe(32)
    request.session.clear()
    request.session.update(
        {"discord_state": state, "oauth_link_user_id": session_row.user_id, "oauth_redirect": dest}
    )
    url = discord_oauth.authorize_url(
        redirect_uri=get_settings().discord_link_redirect_uri, state=state, scopes=["identify"]
    )
    return RedirectResponse(url, status_code=302)


@router.get("/auth/oauth/discord/callback/", dependencies=[Depends(require_discord_enabled)])
def discord_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    expected_state = request.session.get("discord_state")
    link_user_id = request.session.get("oauth_link_user_id")
    dest = request.session.get("oauth_redirect") or "/connect/discord"

    def fail(reason: str) -> RedirectResponse:
        return _bounce(request, with_query(dest, error=reason))

    if error:
        return fail("discord_cancelled" if error == "access_denied" else "discord_failed")
    if not (code and state and expected_state and secrets.compare_digest(state, expected_state)):
        return fail("discord_failed")
    session_row = get_active_session(db, access_token) if access_token else None
    if session_row is None or session_row.user_id != link_user_id:
        return fail("discord_failed")

    try:
        token = discord_oauth.exchange_code(code, get_settings().discord_link_redirect_uri)
        profile = discord_oauth.fetch_current_user(token["access_token"])
        account_id = str(profile["id"])
    except (discord_oauth.DiscordOAuthError, KeyError):
        return fail("discord_failed")
    username = profile.get("username")

    try:
        link_identity(db, session_row.user, OAuthProvider.discord, account_id, username=username)
        # link_identity commits the link itself, so the marks follow in their own commit.
        mark_account_everywhere(db, session_row.user_id, int(account_id))
        db.commit()
    except IdentityLinkError as exc:
        own = (
            db.query(OAuthIdentity)
            .filter(
                OAuthIdentity.user_id == session_row.user_id,
                OAuthIdentity.provider == OAuthProvider.discord,
            )
            .first()
        )
        if own is None or own.provider_account_id != account_id:
            return fail(exc.code)
        own.username_at_provider = username
        db.commit()
    return _bounce(request, with_query(dest, linked="discord"))
