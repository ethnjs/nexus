"""
Core auth utilities.

- Password hashing via bcrypt (passlib)
- JWT creation/decoding via python-jose
- Verification tokens (signup verify / email change / password reset)
- FastAPI dependencies: get_current_user, require_admin

Tournament-level permission checking lives in app/core/permissions.py.
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Literal

from fastapi import Cookie, Depends, HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.models.models import User, VerificationToken

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7


def create_access_token(user_id: int) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload = {"sub": str(user_id), "exp": expire, "aud": "session"}
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[int]:
    """Returns user_id from a valid token, or None if invalid/expired."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM], audience="session")
        user_id = payload.get("sub")
        if user_id is None:
            return None
        return int(user_id)
    except JWTError:
        return None


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

def get_current_user(
    access_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    """
    Reads JWT from the httpOnly 'access_token' cookie.
    Raises 401 if missing, invalid, expired, or user inactive.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )
    if not access_token:
        raise credentials_exception

    user_id = decode_access_token(access_token)
    if user_id is None:
        raise credentials_exception

    user = db.query(User).filter(
        User.id == user_id,
        User.is_active == True,
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