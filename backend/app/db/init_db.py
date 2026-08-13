"""
Database initialization utilities.

Run directly to create tables:
    python -m app.db.init_db

Or called automatically from app startup lifespan.
"""

from sqlalchemy.orm import Session
from app.db.session import engine, Base
from app.models import models  # noqa: F401 — must import so Base sees the models
from app.core.config import get_settings

settings = get_settings()


def init_db() -> None:
    """Create all tables defined on Base metadata."""
    Base.metadata.create_all(bind=engine)
    print("✓ Database tables created.")


def seed_dev_data(db: Session) -> None:
    """
    Seed dev database with:
    - 1 admin account  (role="admin")
    - 15 regular user accounts  (role="user")

    No tournament is created — tournament setup is handled separately.

    Idempotent — skips if admin already exists.
    """
    from app.models.models import User
    from app.core.auth import hash_password

    # Skip if already seeded
    if db.query(User).filter(User.email == "admin@nexus.dev").first():
        print("✓ Dev seed already exists, skipping.")
        return

    # Admin account — full site-wide access, bypasses all tournament checks.
    admin = User(
        email="admin@nexus.dev",
        hashed_password=hash_password("admin1234"),
        first_name="Admin",
        last_name="User",
        role="admin",
        status="active",
    )
    db.add(admin)

    # 15 regular user accounts — user1@nexus.dev .. user15@nexus.dev, all password "user1234"
    users = [
        User(
            email=f"user{i}@nexus.dev",
            hashed_password=hash_password("user1234"),
            first_name="User",
            last_name=str(i),
            role="user",
            status="active",
        )
        for i in range(1, 16)
    ]
    db.add_all(users)

    db.commit()

    print("✓ Seeded: admin@nexus.dev / admin1234  (role=admin)")
    print("✓ Seeded: user1@nexus.dev .. user15@nexus.dev / user1234  (role=user)")


if __name__ == "__main__":
    from app.db.session import SessionLocal

    init_db()

    if settings.app_env in ("development", "preview"):
        with SessionLocal() as db:
            seed_dev_data(db)