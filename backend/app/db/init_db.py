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
    from app.models.models import Event, Membership, Tournament, TournamentCategory, TimeBlock, User
    from app.core.auth import hash_password
    from app.core.permissions import DEFAULT_POSITIONS, DEFAULT_CATEGORIES
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
        volunteer_schema={
            "custom_fields": [],
            "positions": DEFAULT_POSITIONS,
        },
    )
    db.add(tournament)
    db.flush()  # get tournament.id before creating time_blocks, categories, memberships

    # Seed default categories
    for cat_name in DEFAULT_CATEGORIES:
        db.add(TournamentCategory(
            tournament_id=tournament.id,
            name=cat_name,
            is_custom=False,
        ))

    # Seed sample time blocks
    sample_blocks = [
        ("Block 1", "2026-05-23", "08:00", "09:00"),
        ("Block 2", "2026-05-23", "09:15", "10:15"),
        ("Block 3", "2026-05-23", "10:30", "11:30"),
        ("Block 4", "2026-05-23", "12:30", "13:30"),
        ("Block 5", "2026-05-23", "13:45", "14:45"),
        ("Block 6", "2026-05-23", "15:00", "16:00"),
        ("Scoring", "2026-05-23", "16:15", "17:15"),
        ("Awards",  "2026-05-23", "17:30", "18:30"),
    ]
    for label, date, start, end in sample_blocks:
        db.add(TimeBlock(
            tournament_id=tournament.id,
            label=label,
            date=date,
            start=start,
            end=end,
        ))

    db.flush()  # get time block IDs before creating events

    # Build category name → id lookup
    cat_map = {
        cat.name: cat.id
        for cat in db.query(TournamentCategory).filter_by(tournament_id=tournament.id).all()
    }

    # 2026 Science Olympiad events
    # Format: (name, division, category_name)
    LIFE   = "Life, Personal & Social Science"
    EARTH  = "Earth and Space Science"
    PHYS   = "Physical Science & Chemistry"
    TECH   = "Technology & Engineering"
    INQ    = "Inquiry & Nature of Science"

    events_div_b = [
        ("Anatomy & Physiology",  "B", LIFE),
        ("Astronomy",             "B", EARTH),
        ("Bungee Drop",           "B", TECH),
        ("Chemistry Lab",         "B", PHYS),
        ("Code Busters",          "B", TECH),
        ("Crime Busters",         "B", INQ),
        ("Disease Detectives",    "B", LIFE),
        ("Dynamic Planet",        "B", EARTH),
        ("Ecology",               "B", LIFE),
        ("Electric Vehicle",      "B", TECH),
        ("Food Science",          "B", PHYS),
        ("Forestry",              "B", LIFE),
        ("Geologic Mapping",      "B", EARTH),
        ("Helicopters",           "B", TECH),
        ("Microbe Mission",       "B", LIFE),
        ("Mouse Trap Vehicle",    "B", TECH),
        ("Optics",                "B", PHYS),
        ("Ping Pong Parachute",   "B", TECH),
        ("Rocks & Minerals",      "B", EARTH),
        ("Scrambler",             "B", TECH),
        ("Solar System",          "B", EARTH),
        ("Towers",                "B", TECH),
        ("Write It Do It",        "B", INQ),
    ]

    events_div_c = [
        ("Anatomy & Physiology",  "C", LIFE),
        ("Astronomy",             "C", EARTH),
        ("Bungee Drop",           "C", TECH),
        ("Chemistry Lab",         "C", PHYS),
        ("Code Busters",          "C", TECH),
        ("Disease Detectives",    "C", LIFE),
        ("Dynamic Planet",        "C", EARTH),
        ("Ecology",               "C", LIFE),
        ("Electric Vehicle",      "C", TECH),
        ("Experimental Design",   "C", INQ),
        ("Fermi Questions",       "C", INQ),
        ("Flight",                "C", TECH),
        ("Forensics",             "C", PHYS),
        ("Geologic Mapping",      "C", EARTH),
        ("Helicopters",           "C", TECH),
        ("Materials Science",     "C", PHYS),
        ("Microbe Mission",       "C", LIFE),
        ("Optics",                "C", PHYS),
        ("Remote Sensing",        "C", EARTH),
        ("Rocks & Minerals",      "C", EARTH),
        ("Scrambler",             "C", TECH),
        ("Towers",                "C", TECH),
        ("Write It Do It",        "C", INQ),
    ]

    for name, division, cat_name in events_div_b + events_div_c:
        db.add(Event(
            tournament_id=tournament.id,
            name=name,
            division=division,
            event_type="standard",
            category_id=cat_map.get(cat_name),
            volunteers_needed=2,
        ))

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