from app.models.models import User, utcnow

# The "Last updated" date of frontend/content/legal/terms.md and privacy.md.
# Changing it makes every user accept again; tests/core/test_legal.py keeps it in sync.
TERMS_VERSION = "2026-11-01"


def record_terms_acceptance(user: User) -> None:
    """Marks the current terms as accepted. Does not commit."""
    user.terms_version = TERMS_VERSION
    user.terms_accepted_at = utcnow()


def needs_terms_acceptance(user: User) -> bool:
    return user.terms_version != TERMS_VERSION
