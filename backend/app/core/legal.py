from datetime import date

from fastapi import HTTPException, status

from app.core.age import calculate_age
from app.models.models import User, utcnow

# The "Last updated" date of frontend/content/legal/terms.md and privacy.md.
# Changing it makes every user accept again; tests/core/test_legal.py keeps it in sync.
TERMS_VERSION = "2026-11-07"

MINIMUM_AGE = 13
AGE_OF_MAJORITY = 18


def record_terms_acceptance(user: User) -> None:
    """Marks the current terms as accepted. Does not commit."""
    user.terms_version = TERMS_VERSION
    user.terms_accepted_at = utcnow()


def needs_terms_acceptance(user: User) -> bool:
    return user.terms_version != TERMS_VERSION


def is_under_minimum_age(birth_date: date) -> bool:
    return calculate_age(birth_date, date.today()) < MINIMUM_AGE


def needs_parent_consent(user: User) -> bool:
    return (
        user.date_of_birth is not None
        and calculate_age(user.date_of_birth, date.today()) < AGE_OF_MAJORITY
        and user.parent_consent_at is None
    )


def require_parent_consent(user: User, consent: bool) -> None:
    """Records consent for a minor who hasn't given it, or raises 422 with detail.code
    "parent_consent_required" if `consent` is false. Does not commit."""
    if not needs_parent_consent(user):
        return
    if not consent:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {
                "code": "parent_consent_required",
                "message": "A parent or guardian must agree to the Terms of Service for you.",
            },
        )
    user.parent_consent_at = utcnow()
