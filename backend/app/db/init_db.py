"""
Database initialization utilities.

Run directly to bring the schema up to date:
    python -m app.db.init_db

Or called automatically from app startup lifespan.
"""

from pathlib import Path

from sqlalchemy.orm import Session
from app.models import models  # noqa: F401 — must import so Base sees the models
from app.core.config import get_settings

settings = get_settings()

# backend/ — where alembic.ini and the alembic/ directory live.
BACKEND_ROOT = Path(__file__).resolve().parents[2]


def init_db() -> None:
    """Bring the database up to the migration head.

    This used to be Base.metadata.create_all(), which was a quiet source of
    drift: create_all builds any *missing* table straight from the models, so
    a migration's schema half would appear to have been applied while its data
    half never ran. That's how every tournament-owned form ended up without
    its tournament_forms companion row — the table existed, the backfill in
    8d55ec2b6640 never executed, and nothing errored. create_all also can't
    express an ALTER, so column-level changes never reached an existing dev
    database at all.

    Running the migrations instead makes alembic the single source of truth
    for schema in every environment. Note this is only wired up for
    development/preview (see app/main.py's lifespan) — production applies
    migrations as its own deploy step, not on boot.
    """
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    command.upgrade(cfg, "head")
    print("✓ Database migrated to head.")


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