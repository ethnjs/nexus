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
    - 1 regular user account  (role="user", tournament_director membership)
    - 1 sample tournament owned by the regular user
    - TD membership for the regular user (positions=["tournament_director"])
    - Volunteer membership for the admin (positions=["event_supervisor"])
      — demonstrates that admin can also hold a per-tournament membership

    Idempotent — skips if admin already exists.
    """
    from app.models.models import Membership, Tournament, User
    from app.core.auth import hash_password
    from app.core.permissions import DEFAULT_POSITIONS
    from datetime import datetime

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
        is_active=True,
    )
    db.add(admin)

    # Regular user account — tournament access determined by membership positions.
    # Previously "td@nexus.dev" with role="td"; now role="user" with a
    # tournament_director membership on the sample tournament.
    td = User(
        email="td@nexus.dev",
        hashed_password=hash_password("td1234"),
        first_name="Tournament",
        last_name="Director",
        role="user",
        is_active=True,
    )
    db.add(td)
    db.flush()  # get IDs before creating tournament + memberships

    # Sample tournament owned by the regular user
    tournament = Tournament(
        name="2026 National Tournament @ USC",
        start_date=datetime(2026, 5, 21, 8, 0),
        end_date=datetime(2026, 5, 23, 18, 0),
        location="University of Southern California",
        owner_id=td.id,
        blocks=[
            {"number": 1, "label": "Block 1", "date": "2026-05-23", "start": "08:00", "end": "09:00"},
            {"number": 2, "label": "Block 2", "date": "2026-05-23", "start": "09:15", "end": "10:15"},
            {"number": 3, "label": "Block 3", "date": "2026-05-23", "start": "10:30", "end": "11:30"},
            {"number": 4, "label": "Block 4", "date": "2026-05-23", "start": "12:30", "end": "13:30"},
            {"number": 5, "label": "Block 5", "date": "2026-05-23", "start": "13:45", "end": "14:45"},
            {"number": 6, "label": "Block 6", "date": "2026-05-23", "start": "15:00", "end": "16:00"},
            {"number": 7, "label": "Scoring",  "date": "2026-05-23", "start": "16:15", "end": "17:15"},
            {"number": 8, "label": "Awards",   "date": "2026-05-23", "start": "17:30", "end": "18:30"},
        ],
        volunteer_schema={
            "custom_fields": [],
            "positions": DEFAULT_POSITIONS,
        },
    )
    db.add(tournament)
    db.flush()  # get tournament.id before creating memberships

    # TD membership for the regular user — full manage_tournament access
    td_membership = Membership(
        user_id=td.id,
        tournament_id=tournament.id,
        positions=["tournament_director"],
        status="confirmed",
    )
    db.add(td_membership)

    # Volunteer membership for admin — demonstrates cross-role scenario:
    # admin has site-wide access AND a volunteer-level membership here
    admin_membership = Membership(
        user_id=admin.id,
        tournament_id=tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    )
    db.add(admin_membership)

    db.commit()

    print("✓ Seeded: admin@nexus.dev / admin1234  (role=admin, event_supervisor in sample tournament)")
    print("✓ Seeded: td@nexus.dev / td1234  (role=user, tournament_director in sample tournament)")
    print(f"✓ Seeded tournament: '{tournament.name}'")


if __name__ == "__main__":
    from app.db.session import SessionLocal

    init_db()

    if settings.app_env in ("development", "preview"):
        with SessionLocal() as db:
            seed_dev_data(db)