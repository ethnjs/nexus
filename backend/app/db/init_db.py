"""
Database initialization utilities.

Run directly to create tables:
    python -m app.db.init_db

Or call init_db() from the app startup event.
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
    Insert a single hardcoded tournament for the beta.
    Idempotent — skips if the tournament already exists.
    """
    from datetime import datetime
    from app.models.models import Tournament

    existing = db.query(Tournament).filter_by(name="Nexus Invitational 2025").first()
    if existing:
        print("✓ Dev tournament already exists, skipping seed.")
        return

    tournament = Tournament(
        name="Nexus Invitational 2025",
        date=datetime(2025, 11, 15),
        location="Nexus High School",
    )
    db.add(tournament)
    db.commit()
    db.refresh(tournament)
    print(f"✓ Seeded dev tournament: id={tournament.id}, name={tournament.name}")


if __name__ == "__main__":
    from app.db.session import SessionLocal

    init_db()

    if settings.app_env == "development":
        with SessionLocal() as db:
            seed_dev_data(db)