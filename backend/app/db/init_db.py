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

    existing = db.query(Tournament).filter_by(name="Nexus Beta Invitational 2025").first()
    if existing:
        print("✓ Dev tournament already exists, skipping seed.")
        return

    tournament = Tournament(
        name="Nexus Beta Invitational 2025",
        start_date=datetime(2025, 11, 15, 8, 0),
        end_date=datetime(2025, 11, 15, 18, 0),
        location="Beta High School",
        blocks=[
            {"number": 1, "label": "Block 1", "start": "08:00", "end": "09:00"},
            {"number": 2, "label": "Block 2", "start": "09:15", "end": "10:15"},
            {"number": 3, "label": "Block 3", "start": "10:30", "end": "11:30"},
            {"number": 4, "label": "Block 4", "start": "12:30", "end": "13:30"},
            {"number": 5, "label": "Block 5", "start": "13:45", "end": "14:45"},
            {"number": 6, "label": "Block 6", "start": "15:00", "end": "16:00"},
            {"number": 7, "label": "Scoring", "start": "16:15", "end": "17:15"},
            {"number": 8, "label": "Awards",  "start": "17:30", "end": "18:30"},
        ],
        volunteer_schema={"custom_fields": []},
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