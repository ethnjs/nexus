"""
Shared join-code logic used by every join-code feature (chapters,
tournaments, ...). The underlying tables differ (which parent they belong
to), but code generation, expiry checking, and the one-way-deactivation
patch rule are identical regardless of parent.
"""
from __future__ import annotations
import secrets
import string
from datetime import datetime, timezone
from typing import Protocol

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

AMBIGUOUS_CHARS = set("0O1Il")
ALLOWED_CHARS = "".join(c for c in string.ascii_letters + string.digits if c not in AMBIGUOUS_CHARS)


class JoinCodeLike(Protocol):
    code: str
    is_active: bool
    expires_at: datetime | None


def generate_join_code(length: int = 8) -> str:
    """Cryptographically secure random alphanumeric code, ambiguous characters excluded."""
    return "".join(secrets.choice(ALLOWED_CHARS) for _ in range(length))


def is_join_code_expired(join_code: JoinCodeLike) -> bool:
    """Return whether a join code has passed its optional expiration time."""
    if join_code.expires_at is None:
        return False
    expires_at = join_code.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) > expires_at


def get_unique_join_code(db: Session, model: type, max_retries: int = 10) -> str:
    """
    Generate a join code guaranteed unique against `model.code`.
    `model` is the join-code ORM class (e.g. ChapterJoinCode, TournamentJoinCode).
    """
    for _ in range(max_retries):
        code = generate_join_code()
        if not db.query(model).filter(model.code == code).first():
            return code

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Could not generate a unique join code. Please try again.",
    )


def apply_join_code_patch(join_code: JoinCodeLike, updates: dict) -> None:
    """
    Apply a partial update to a join code, enforcing that is_active can only
    go True -> False (deactivation is one-way; reactivation is rejected).
    """
    if "is_active" in updates:
        if updates["is_active"] and not join_code.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot reactivate a deactivated join code",
            )
        if not updates["is_active"] and not join_code.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Join code is already deactivated",
            )

    for field, value in updates.items():
        setattr(join_code, field, value)
