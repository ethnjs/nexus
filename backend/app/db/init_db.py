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


def seed_users(db: Session) -> None:
    """
    Seed dev users:
    - 1 admin account  (role="admin")
    - 1 regular user account  (role="user")

    Idempotent — skips if admin already exists.
    """
    from app.models.models import User
    from app.core.auth import hash_password

    if db.query(User).filter(User.email == "admin@nexus.dev").first():
        print("✓ Dev users already exist, skipping.")
        return

    admin = User(
        email="admin@nexus.dev",
        hashed_password=hash_password("admin1234"),
        first_name="Admin",
        last_name="User",
        role="admin",
        is_active=True,
    )
    db.add(admin)

    td = User(
        email="td@nexus.dev",
        hashed_password=hash_password("td1234"),
        first_name="Tournament",
        last_name="Director",
        role="user",
        is_active=True,
    )
    db.add(td)
    db.commit()

    print("✓ Seeded: admin@nexus.dev / admin1234  (role=admin)")
    print("✓ Seeded: td@nexus.dev / td1234  (role=user)")


def seed_tournament(db: Session) -> None:
    """
    Seed the sample tournament, default categories, and memberships.

    Idempotent — skips if the tournament already exists.
    Requires seed_users to have run first.
    """
    from app.models.models import Membership, Tournament, TournamentCategory, User
    from app.core.permissions import DEFAULT_POSITIONS, DEFAULT_CATEGORIES
    from datetime import datetime

    if db.query(Tournament).filter(Tournament.name == "2026 National Tournament @ USC").first():
        print("✓ Dev tournament already exists, skipping.")
        return

    td = db.query(User).filter(User.email == "td@nexus.dev").first()
    admin = db.query(User).filter(User.email == "admin@nexus.dev").first()
    if not td or not admin:
        print("✗ seed_tournament requires seed_users to run first — skipping.")
        return

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
    db.flush()

    for cat_name in DEFAULT_CATEGORIES:
        db.add(TournamentCategory(
            tournament_id=tournament.id,
            name=cat_name,
            is_custom=False,
        ))

    db.add(Membership(
        user_id=td.id,
        tournament_id=tournament.id,
        positions=["tournament_director"],
        status="confirmed",
    ))
    db.add(Membership(
        user_id=admin.id,
        tournament_id=tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()

    print(f"✓ Seeded tournament: '{tournament.name}'")


def seed_time_blocks(db: Session) -> None:
    """
    Seed sample time blocks for the dev tournament.

    Idempotent — skips if any time blocks already exist for the tournament.
    Requires seed_tournament to have run first.
    """
    from app.models.models import TimeBlock, Tournament

    tournament = db.query(Tournament).filter(Tournament.name == "2026 National Tournament @ USC").first()
    if not tournament:
        print("✗ seed_time_blocks requires seed_tournament to run first — skipping.")
        return

    if db.query(TimeBlock).filter(TimeBlock.tournament_id == tournament.id).first():
        print("✓ Dev time blocks already exist, skipping.")
        return

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
    db.commit()

    print(f"✓ Seeded {len(sample_blocks)} time blocks.")


def seed_events(db: Session) -> None:
    """
    Seed 2026 Science Olympiad events for the dev tournament.

    Idempotent — skips if any events already exist for the tournament.
    Requires seed_tournament to have run first.
    """
    from app.models.models import Event, Tournament, TournamentCategory

    tournament = db.query(Tournament).filter(Tournament.name == "2026 National Tournament @ USC").first()
    if not tournament:
        print("✗ seed_events requires seed_tournament to run first — skipping.")
        return

    from app.models.models import Event as EventModel
    if db.query(EventModel).filter(EventModel.tournament_id == tournament.id).first():
        print("✓ Dev events already exist, skipping.")
        return

    cat_map = {
        cat.name: cat.id
        for cat in db.query(TournamentCategory).filter_by(tournament_id=tournament.id).all()
    }

    LIFE  = "Life, Personal & Social Science"
    EARTH = "Earth and Space Science"
    PHYS  = "Physical Science & Chemistry"
    TECH  = "Technology & Engineering"
    INQ   = "Inquiry & Nature of Science"

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

    all_events = events_div_b + events_div_c
    for name, division, cat_name in all_events:
        db.add(Event(
            tournament_id=tournament.id,
            name=name,
            division=division,
            event_type="standard",
            category_id=cat_map.get(cat_name),
            volunteers_needed=2,
        ))
    db.commit()

    print(f"✓ Seeded {len(all_events)} events.")


if __name__ == "__main__":
    from app.db.session import SessionLocal

    init_db()

    if settings.app_env in ("development", "preview"):
        with SessionLocal() as db:
            if settings.seed_users:
                seed_users(db)
            if settings.seed_tournament:
                seed_tournament(db)
            if settings.seed_time_blocks:
                seed_time_blocks(db)
            if settings.seed_events:
                seed_events(db)