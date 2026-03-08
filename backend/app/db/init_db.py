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
    - 1 admin account
    - 1 TD account
    - 1 sample tournament owned by the TD

    Idempotent — skips if admin already exists.
    """
    from app.models.models import User, Tournament
    from app.core.auth import hash_password

    # Skip if already seeded
    if db.query(User).filter(User.email == "admin@nexus.dev").first():
        print("✓ Dev seed already exists, skipping.")
        return

    # Admin account — full access to everything
    admin = User(
        email="admin@nexus.dev",
        hashed_password=hash_password("admin1234"),
        first_name="Admin",
        last_name="Nexus",
        role="admin",
        is_active=True,
    )
    db.add(admin)

    # TD account — scoped to their own tournaments
    td = User(
        email="td@nexus.dev",
        hashed_password=hash_password("td1234"),
        first_name="Tournament",
        last_name="Director",
        role="td",
        is_active=True,
    )
    db.add(td)
    db.flush()  # get IDs before creating tournament

    # Sample tournament owned by the TD
    from datetime import datetime
    tournament = Tournament(
        name="Nexus Beta Invitational 2025",
        start_date=datetime(2025, 11, 15, 8, 0),
        end_date=datetime(2025, 11, 15, 18, 0),
        location="Beta High School",
        owner_id=td.id,
        blocks=[
            {"number": 1, "label": "Block 1", "date": "2025-11-15", "start": "08:00", "end": "09:00"},
            {"number": 2, "label": "Block 2", "date": "2025-11-15", "start": "09:15", "end": "10:15"},
            {"number": 3, "label": "Block 3", "date": "2025-11-15", "start": "10:30", "end": "11:30"},
            {"number": 4, "label": "Block 4", "date": "2025-11-15", "start": "12:30", "end": "13:30"},
            {"number": 5, "label": "Block 5", "date": "2025-11-15", "start": "13:45", "end": "14:45"},
            {"number": 6, "label": "Block 6", "date": "2025-11-15", "start": "15:00", "end": "16:00"},
            {"number": 7, "label": "Scoring",  "date": "2025-11-15", "start": "16:15", "end": "17:15"},
            {"number": 8, "label": "Awards",   "date": "2025-11-15", "start": "17:30", "end": "18:30"},
        ],
        volunteer_schema={"custom_fields": []},
    )
    db.add(tournament)
    db.commit()

    print("✓ Seeded: admin@nexus.dev / admin1234")
    print("✓ Seeded: td@nexus.dev / td1234")
    print(f"✓ Seeded tournament: '{tournament.name}' (owner: td@nexus.dev)")


if __name__ == "__main__":
    from app.db.session import SessionLocal

    init_db()

    if settings.app_env == "development":
        with SessionLocal() as db:
            seed_dev_data(db)