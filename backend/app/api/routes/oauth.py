"""Google OIDC start + callback. Browser navigations, so failures redirect
instead of returning JSON. The access token from Google is not stored."""

from typing import Optional

from authlib.integrations.base_client import OAuthError
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import create_session, get_client_ip, set_auth_cookie
from app.core.config import get_settings
from app.core.oauth import (
    AccountExists,
    AccountInactive,
    frontend_redirect,
    get_google_oauth,
    is_google_configured,
    resolve_google_login,
    safe_redirect_path,
    with_redirect,
)
from app.core.profile_status import is_onboarding_complete
from app.db.session import get_db

router = APIRouter(tags=["auth"])


def _bounce(request: Request, path: str, *, raw_token: Optional[str] = None) -> RedirectResponse:
    request.session.clear()
    response = RedirectResponse(frontend_redirect(path), status_code=302)
    if raw_token is not None:
        set_auth_cookie(response, raw_token)
    return response


def _error_path(code: str) -> str:
    return f"/sign-in?error={code}"


@router.get("/auth/oauth/google/start/")
async def google_start(
    request: Request,
    redirect: Optional[str] = None,
):
    if not is_google_configured():
        return RedirectResponse(frontend_redirect("/sign-in?error=google_unavailable"), status_code=302)

    request.session["oauth_redirect"] = safe_redirect_path(redirect)
    return await get_google_oauth().google.authorize_redirect(
        request,
        get_settings().google_oauth_redirect_uri,
        prompt="select_account",
    )


@router.get("/auth/oauth/google/callback/")
async def google_callback(
    request: Request,
    db: Session = Depends(get_db),
):
    saved_redirect = request.session.get("oauth_redirect")

    provider_error = request.query_params.get("error")
    if provider_error:
        code = "google_cancelled" if provider_error == "access_denied" else "google_failed"
        return _bounce(request, _error_path(code))

    try:
        token = await get_google_oauth().google.authorize_access_token(request)
    except OAuthError as exc:
        code = "google_cancelled" if exc.error == "access_denied" else "google_failed"
        return _bounce(request, _error_path(code))

    claims = token.get("userinfo") or {}

    try:
        user, _created = resolve_google_login(db, claims)
    except AccountExists:
        return _bounce(request, _error_path("google_account_exists"))
    except AccountInactive:
        return _bounce(request, _error_path("google_account_inactive"))
    except (ValueError, IntegrityError):
        return _bounce(request, _error_path("google_failed"))

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
