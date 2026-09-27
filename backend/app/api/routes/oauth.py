"""Google OIDC start + callback. Browser navigations, so failures redirect
instead of returning JSON. The access token from Google is not stored."""

from typing import Optional

from authlib.integrations.base_client import OAuthError
from fastapi import APIRouter, Cookie, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import create_session, get_active_session, get_client_ip, set_auth_cookie
from app.core.config import get_settings
from app.core.oauth import (
    AccountExists,
    AccountInactive,
    GoogleLinkError,
    frontend_redirect,
    get_google_oauth,
    is_google_configured,
    link_google_identity,
    resolve_google_login,
    safe_redirect_path,
    with_redirect,
)
from app.core.profile_status import is_onboarding_complete
from app.db.session import get_db
from app.services.email_service import send_identity_linked_notice

router = APIRouter(tags=["auth"])


def _bounce(request: Request, path: str, *, raw_token: Optional[str] = None) -> RedirectResponse:
    request.session.clear()
    response = RedirectResponse(frontend_redirect(path), status_code=302)
    if raw_token is not None:
        set_auth_cookie(response, raw_token)
    return response


def _error_path(intent: Optional[str], code: str) -> str:
    base = "/settings/security" if intent == "link" else "/sign-in"
    return f"{base}?error={code}"


@router.get("/auth/oauth/google/start/")
async def google_start(
    request: Request,
    intent: str = "login",
    redirect: Optional[str] = None,
    access_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
):
    if intent not in ("login", "link"):
        intent = "login"
    if not is_google_configured():
        return RedirectResponse(frontend_redirect("/sign-in?error=google_unavailable"), status_code=302)

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
    access_token: Optional[str] = Cookie(default=None),
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
            identity = link_google_identity(db, session_row.user, claims)
        except (GoogleLinkError, ValueError) as exc:
            code = exc.code if isinstance(exc, GoogleLinkError) else "google_failed"
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
        db, user.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=get_client_ip(request),
    )
    if is_onboarding_complete(user, db=db):
        dest = saved_redirect or "/dashboard"
    else:
        dest = with_redirect("/onboarding", saved_redirect)
    return _bounce(request, dest, raw_token=raw_token)
