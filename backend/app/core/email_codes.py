"""
Emailed 6-digit code challenges: sign-in, sign-up, step-up, and admin-issued sign-in codes.

A challenge with a token stores sha256(f"{raw_token}:{code}"). The raw token lives only on
the client, so a leaked database can't be brute-forced offline over the million codes.
Admin-issued codes have no token, so they're hashed with Argon2 instead.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import Depends, HTTPException, status
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.auth import (
    RATE_LIMIT_WINDOW,
    _hash_token,
    get_current_session,
    hash_password,
    verify_password,
)
from app.core.config import get_settings
from app.models.models import EmailCode, User, UserSession

CodePurpose = Literal["sign_in", "sign_up", "step_up", "admin_sign_in"]

CODE_TTL = timedelta(minutes=10)
ADMIN_CODE_TTL = timedelta(minutes=30)
MAX_ATTEMPTS = 5
STEP_UP_WINDOW = timedelta(minutes=10)


def _generate_code() -> str:
    return f"{secrets.randbelow(10**6):06d}"


def _code_hash(raw_token: str, code: str) -> str:
    return hashlib.sha256(f"{raw_token}:{code}".encode()).hexdigest()


def start_challenge(
    db: Session,
    purpose: Literal["sign_in", "sign_up", "step_up"],
    *,
    email: str,
    user: User | None = None,
    session: UserSession | None = None,
    hashed_password: str | None = None,
) -> tuple[str, str, EmailCode]:
    """
    Commits a new challenge and returns (raw_token, code, row). Invalidates older open
    challenges for the same purpose and user (email for sign_up, session for step_up).
    Raises 429 if one was created within RATE_LIMIT_WINDOW.
    """
    now = datetime.now(UTC)

    query = db.query(EmailCode).filter(
        EmailCode.purpose == purpose,
        EmailCode.consumed_at.is_(None),
        EmailCode.expires_at > now,
    )
    if purpose == "sign_up":
        query = query.filter(EmailCode.email == email)
    elif purpose == "step_up":
        assert session is not None
        query = query.filter(EmailCode.session_id == session.id)
    else:
        assert user is not None
        query = query.filter(EmailCode.user_id == user.id)
    existing = query.all()

    if any(now - row.created_at < RATE_LIMIT_WINDOW for row in existing):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "We sent you a code less than a minute ago. Wait a minute before requesting another.",
        )
    for row in existing:
        row.consumed_at = now

    raw_token = secrets.token_urlsafe(32)
    code = _generate_code()
    row = EmailCode(
        purpose=purpose,
        user_id=user.id if user else None,
        session_id=session.id if session else None,
        email=email,
        hashed_password=hashed_password,
        token_hash=_hash_token(raw_token),
        code_hash=_code_hash(raw_token, code),
        created_at=now,
        last_sent_at=now,
        expires_at=now + CODE_TTL,
    )
    db.add(row)
    db.commit()
    return raw_token, code, row


def start_admin_sign_in_code(db: Session, user: User, admin: User) -> tuple[str, EmailCode]:
    """Commits a one-time code an admin hands to `user`, accepted at the sign-in code step."""
    now = datetime.now(UTC)
    code = _generate_code()
    row = EmailCode(
        purpose="admin_sign_in",
        user_id=user.id,
        email=user.email,
        code_hash=hash_password(code),
        issued_by=admin.id,
        created_at=now,
        last_sent_at=now,
        expires_at=now + ADMIN_CODE_TTL,
    )
    db.add(row)
    db.commit()
    return code, row


def _consume_admin_code(db: Session, user_id: int, code: str, now: datetime) -> bool:
    admin_rows = (
        db.query(EmailCode)
        .filter(
            EmailCode.purpose == "admin_sign_in",
            EmailCode.user_id == user_id,
            EmailCode.consumed_at.is_(None),
            EmailCode.expires_at > now,
        )
        .all()
    )
    for admin_row in admin_rows:
        if verify_password(code, admin_row.code_hash):
            # Conditional so two concurrent sign-ins can't both spend the same code.
            claimed = (
                db.query(EmailCode)
                .filter(EmailCode.id == admin_row.id, EmailCode.consumed_at.is_(None))
                .update({"consumed_at": now}, synchronize_session=False)
            )
            return claimed == 1
    return False


TOO_MANY_ATTEMPTS = "Too many incorrect codes. Start again to get a new one."
EXPIRED = "This code has expired. Start again to get a new one."


def _closed(message: str) -> HTTPException:
    """The challenge takes no more codes or resends; detail.code tells clients to start over."""
    return HTTPException(status.HTTP_400_BAD_REQUEST, {"code": "code_closed", "message": message})


def _closed_reason(db: Session, token_hash: str) -> HTTPException:
    row = db.query(EmailCode).filter(EmailCode.token_hash == token_hash).first()
    return _closed(TOO_MANY_ATTEMPTS if row and row.attempts >= MAX_ATTEMPTS else EXPIRED)


def verify_challenge(
    db: Session,
    raw_token: str,
    code: str,
    *,
    purposes: tuple[CodePurpose, ...],
    session_id: int | None = None,
) -> EmailCode:
    """
    Checks `code` against the challenge and consumes it on success. Each check counts as an
    attempt; the fifth wrong one consumes the challenge. Raises 400 on any failure. A sign_in
    challenge also accepts the user's open admin-issued code. A closed challenge (expired,
    used, or out of attempts) gets detail.code "code_closed".
    """
    now = datetime.now(UTC)
    token_hash = _hash_token(raw_token)

    conditions = [
        EmailCode.token_hash == token_hash,
        EmailCode.purpose.in_(purposes),
        EmailCode.consumed_at.is_(None),
        EmailCode.expires_at > now,
        EmailCode.attempts < MAX_ATTEMPTS,
    ]
    if session_id is not None:
        conditions.append(EmailCode.session_id == session_id)

    # One UPDATE ... RETURNING, so concurrent guesses can't share an attempt.
    row = db.scalars(
        update(EmailCode)
        .where(*conditions)
        .values(attempts=EmailCode.attempts + 1)
        .returning(EmailCode)
    ).one_or_none()

    if row is None:
        db.commit()
        raise _closed_reason(db, token_hash)

    matched = secrets.compare_digest(row.code_hash, _code_hash(raw_token, code))
    if not matched and row.purpose == "sign_in":
        assert row.user_id is not None
        matched = _consume_admin_code(db, row.user_id, code, now)

    if matched or row.attempts >= MAX_ATTEMPTS:
        row.consumed_at = now
    db.commit()

    if not matched and row.attempts >= MAX_ATTEMPTS:
        raise _closed(TOO_MANY_ATTEMPTS)
    if not matched:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is incorrect.")
    return row


def resend_challenge(db: Session, raw_token: str) -> tuple[str, EmailCode]:
    """Commits a new code for an open challenge and resets its attempts, not its expiry."""
    now = datetime.now(UTC)
    token_hash = _hash_token(raw_token)
    row = (
        db.query(EmailCode)
        .filter(
            EmailCode.token_hash == token_hash,
            EmailCode.consumed_at.is_(None),
            EmailCode.expires_at > now,
        )
        .first()
    )
    if row is None:
        raise _closed_reason(db, token_hash)
    if now < row.last_sent_at + RATE_LIMIT_WINDOW:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "We sent you a code less than a minute ago. Wait a minute before requesting another.",
        )

    code = _generate_code()
    row.code_hash = _code_hash(raw_token, code)
    row.attempts = 0
    row.last_sent_at = now
    db.commit()
    return code, row


def require_recent_code(
    session_row: UserSession = Depends(get_current_session),
) -> UserSession:
    """
    Dependency for sensitive actions: the session must have entered a code (at sign-in or
    step-up) within STEP_UP_WINDOW. Otherwise 403 with detail.code "step_up_required".
    """
    if not get_settings().login_codes_required:
        return session_row
    verified_at = session_row.code_verified_at
    if verified_at is None or datetime.now(UTC) - verified_at > STEP_UP_WINDOW:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "step_up_required", "message": "Enter the code we emailed you to continue."},
        )
    return session_row
