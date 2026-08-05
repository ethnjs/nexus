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
    - 1 sample tournament owned by the regular user, with DEFAULT_ROLES populated
    - TD membership for the regular user (holds the tournament_director role)
    - Volunteer membership for the admin (holds the event_supervisor role)
      — demonstrates that admin can also hold a per-tournament membership

    Idempotent — skips if admin already exists.
    """
    from app.models.models import (
        Tournament, TournamentMembership, TournamentMembershipRole, TournamentRole, User,
    )
    from app.core.auth import hash_password
    from app.core.tournament.permissions import DEFAULT_ROLES
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
        status="active",
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
        status="active",
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
    )
    db.add(tournament)
    db.flush()  # get tournament.id before creating roles/memberships

    role_rows = [TournamentRole(tournament_id=tournament.id, **r) for r in DEFAULT_ROLES]
    db.add_all(role_rows)
    db.flush()  # get role ids
    roles_by_key = {r.key: r for r in role_rows}

    # TD membership for the regular user — holds the tournament_director role
    td_membership = TournamentMembership(
        user_id=td.id,
        tournament_id=tournament.id,
        status="confirmed",
    )
    db.add(td_membership)
    db.flush()
    db.add(TournamentMembershipRole(
        membership_id=td_membership.id, role_id=roles_by_key["tournament_director"].id,
    ))

    # Volunteer membership for admin — demonstrates cross-role scenario:
    # admin has site-wide access AND a volunteer-level membership here
    admin_membership = TournamentMembership(
        user_id=admin.id,
        tournament_id=tournament.id,
        status="confirmed",
    )
    db.add(admin_membership)
    db.flush()
    db.add(TournamentMembershipRole(
        membership_id=admin_membership.id, role_id=roles_by_key["event_supervisor"].id,
    ))

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