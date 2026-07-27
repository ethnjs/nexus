"""
Core auth utilities.

- Password hashing via bcrypt (passlib)
- JWT creation/decoding via python-jose
- Verification tokens (signup verify / email change / password reset)
- FastAPI dependencies: get_current_user, require_admin

Tournament-level permission checking lives in app/core/permissions.py.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Literal

from fastapi import Cookie, Depends, HTTPException, Request, Response, status
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.models.models import User, VerificationToken, UserSession

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ---------------------------------------------------------------------------
# Sessions
# Replaces the previous stateless JWT — the access_token cookie now holds
# a random opaque session token (not a JWT). This trades a small amount of
# stateless-JWT convenience for the ability to actually revoke access in
# real time (a JWT stays valid until it naturally expires; nothing short
# of a DB-backed check can kill it early).
#
# token_hash uses SHA-256, not bcrypt — this gets checked on every single
# authenticated request, and the raw token is already high-entropy random,
# so slow adaptive hashing isn't needed and would add real per-request
# latency. Lookup is a direct indexed equality match, unlike
# consume_verification_token's loop-and-bcrypt-verify (fine there since
# verification tokens are rare; wrong here since sessions are constant).
# ---------------------------------------------------------------------------

SESSION_EXPIRE_DAYS = 7  # fixed from creation — no sliding renewal
SESSION_ACTIVITY_THROTTLE = timedelta(minutes=15)  # last_active_at update granularity


def _hash_session_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def get_client_ip(request: Request) -> Optional[str]:
    """
    Prefers X-Forwarded-For (Render sits in front of the app), falls back
    to the direct connection IP. Takes the first entry — the original
    client — since X-Forwarded-For can be a comma-separated chain of proxies.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def create_session(
    db: Session,
    user_id: int,
    user_agent: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> str:
    """
    Creates a new session and returns the raw token — this is the only
    time it exists in plaintext; only its SHA-256 hash is persisted.
    """
    now = datetime.now(timezone.utc)
    raw_token = secrets.token_urlsafe(32)

    session_row = UserSession(
        user_id=user_id,
        token_hash=_hash_session_token(raw_token),
        user_agent=user_agent,
        ip_address=ip_address,
        expires_at=now + timedelta(days=SESSION_EXPIRE_DAYS),
    )
    db.add(session_row)
    db.commit()

    return raw_token


def get_active_session(db: Session, raw_token: str) -> Optional[UserSession]:
    """
    Looks up a session by its raw token. Returns the row if valid (not
    revoked, not expired), else None.

    Updates last_active_at, but only if it's stale by
    SESSION_ACTIVITY_THROTTLE or more — this field is display-only (the
    settings device list's "active Xh ago"), not part of any validity
    check, so it doesn't need writing on every request.
    """
    now = datetime.now(timezone.utc)
    token_hash = _hash_session_token(raw_token)

    session_row = db.query(UserSession).filter(
        UserSession.token_hash == token_hash,
        UserSession.revoked_at.is_(None),
        UserSession.expires_at > now,
    ).first()

    if session_row is None:
        return None

    if session_row.last_active_at is None or (now - session_row.last_active_at) >= SESSION_ACTIVITY_THROTTLE:
        session_row.last_active_at = now
        db.commit()

    return session_row


def revoke_session(db: Session, session_row: UserSession) -> None:
    """Revokes a single session — e.g. explicit logout of just this device."""
    session_row.revoked_at = datetime.now(timezone.utc)
    db.commit()


def revoke_all_other_sessions(db: Session, user_id: int, keep_session_id: int) -> None:
    """'Log out everywhere' — revokes every session for the user except the current one."""
    now = datetime.now(timezone.utc)
    db.query(UserSession).filter(
        UserSession.user_id == user_id,
        UserSession.id != keep_session_id,
        UserSession.revoked_at.is_(None),
    ).update({"revoked_at": now}, synchronize_session=False)
    db.commit()


def revoke_all_sessions(db: Session, user_id: int) -> None:
    """
    Revokes EVERY session for the user, including whatever's currently
    active — used for admin account-locking, where the point is immediate
    total lockout, not preserving anyone's current session.
    """
    now = datetime.now(timezone.utc)
    db.query(UserSession).filter(
        UserSession.user_id == user_id,
        UserSession.revoked_at.is_(None),
    ).update({"revoked_at": now}, synchronize_session=False)
    db.commit()


# ---------------------------------------------------------------------------
# Auth cookie
# ---------------------------------------------------------------------------

COOKIE_NAME = "access_token"
COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days in seconds


def set_auth_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    is_prod = settings.app_env == "production"
    is_preview = settings.app_env == "preview"
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=is_prod or is_preview,
        samesite="none" if (is_prod or is_preview) else "lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
        domain=".ethanshih.com" if is_prod else None,
    )


def clear_auth_cookie(response: Response) -> None:
    settings = get_settings()
    is_prod = settings.app_env == "production"
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        domain=".ethanshih.com" if is_prod else None,
    )


# ---------------------------------------------------------------------------
# Verification tokens
# Backs signup email verification, email-change, and password reset.
# Raw token is emailed to the user; only its hash is ever persisted
# (VerificationToken.token_hash, via the same bcrypt context as passwords).
# ---------------------------------------------------------------------------

Purpose = Literal["signup_verify", "email_change", "password_reset", "account_setup"]

TOKEN_TTL: dict[Purpose, timedelta] = {
    "signup_verify": timedelta(hours=24),
    "email_change": timedelta(hours=24),
    "password_reset": timedelta(hours=1),
    "account_setup": timedelta(days=7),  # admin invites sit longer before expiring
}

RATE_LIMIT_WINDOW = timedelta(seconds=60)


class RateLimitedError(Exception):
    """Raised when a new token is requested too soon after a prior one."""
    pass


def create_verification_token(
    db: Session,
    user_id: int,
    purpose: Purpose,
    new_email: Optional[str] = None,
) -> str:
    """
    Creates a new verification token for the given user + purpose.

    - Rate limits: raises RateLimitedError if an unconsumed, unexpired token
      for this (user_id, purpose) was created within RATE_LIMIT_WINDOW.
    - Stale-token guarding: invalidates (marks used_at) any other unconsumed
      tokens for this (user_id, purpose) before issuing the new one, so only
      the most recently issued link is ever valid.

    Returns the raw token — this is the only time it exists in plaintext.
    """
    now = datetime.now(timezone.utc)

    existing = (
        db.query(VerificationToken)
        .filter(
            VerificationToken.user_id == user_id,
            VerificationToken.purpose == purpose,
            VerificationToken.used_at.is_(None),
            VerificationToken.expires_at > now,
        )
        .all()
    )

    for row in existing:
        if row.created_at is not None and (now - row.created_at) < RATE_LIMIT_WINDOW:
            raise RateLimitedError(
                f"A {purpose} request was already made recently. Please wait before retrying."
            )

    # Stale-token guarding — invalidate any other pending tokens for this purpose
    for row in existing:
        row.used_at = now

    raw_token = secrets.token_urlsafe(32)

    token_row = VerificationToken(
        user_id=user_id,
        token_hash=hash_password(raw_token),
        purpose=purpose,
        new_email=new_email,
        expires_at=now + TOKEN_TTL[purpose],
    )
    db.add(token_row)
    db.commit()

    return raw_token


def consume_verification_token(
    db: Session,
    raw_token: str,
    expected_purpose: Purpose,
) -> Optional[VerificationToken]:
    """
    Validates and consumes a raw token for the given purpose.

    Returns the VerificationToken row (with .user_id / .new_email available)
    on success, or None if no matching, unexpired, unconsumed token is found.
    Marks the row used_at on success — tokens are single-use.
    """
    now = datetime.now(timezone.utc)

    candidates = (
        db.query(VerificationToken)
        .filter(
            VerificationToken.purpose == expected_purpose,
            VerificationToken.used_at.is_(None),
            VerificationToken.expires_at > now,
        )
        .all()
    )

    for row in candidates:
        if verify_password(raw_token, row.token_hash):
            row.used_at = now
            db.commit()
            return row

    return None


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

def get_current_session(
    access_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> UserSession:
    """
    Reads the opaque session token from the httpOnly 'access_token' cookie
    and resolves it to an active UserSession row.
    Raises 401 if missing, invalid, expired, or revoked.

    Split out from get_current_user so routes that need the session itself
    (e.g. "log out everywhere" needs to exclude the current session, the
    settings device list needs to mark which one is current) can depend on
    this directly instead of re-deriving it from the user.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )
    if not access_token:
        raise credentials_exception

    session_row = get_active_session(db, access_token)
    if session_row is None:
        raise credentials_exception

    return session_row


def get_current_user(
    session_row: UserSession = Depends(get_current_session),
    db: Session = Depends(get_db),
) -> User:
    """
    Resolves the current session to its User.
    Raises 401 if the user no longer exists or isn't active.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )

    user = db.query(User).filter(
        User.id == session_row.user_id,
        User.status == "active",
    ).first()
    if user is None:
        raise credentials_exception

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """
    Dependency — restricts a route to admin users only.
    Used for site-wide admin operations (e.g. GET /users/, POST /auth/register).

    For tournament-level permission checks use require_permission() from
    app.core.permissions instead.
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )
    return current_user