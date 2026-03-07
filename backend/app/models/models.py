"""
SQLAlchemy ORM models.

NOTE: Using classic Column style (not Mapped[] annotations) for compatibility
with SQLAlchemy 2.0.36 + Python 3.13.

STATUS LEGEND:
  [BETA]   — built and active now
  [FUTURE] — defined for schema planning, migrations will add these later

All tables are defined here so foreign key relationships are clear
and future additions don't require restructuring existing models.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Integer, String, Text, Boolean, DateTime, JSON,
    ForeignKey, UniqueConstraint, Column,
)
from sqlalchemy.orm import relationship
from app.db.session import Base


def utcnow():
    """Timezone-aware UTC timestamp — use instead of deprecated datetime.utcnow()."""
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# [BETA] Tournament
# ---------------------------------------------------------------------------
class Tournament(Base):
    __tablename__ = "tournaments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    date = Column(DateTime, nullable=True)
    location = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    sheet_configs = relationship(
        "SheetConfig", back_populates="tournament", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# [BETA] SheetConfig
# ---------------------------------------------------------------------------
class SheetConfig(Base):
    __tablename__ = "sheet_configs"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(
        Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False
    )
    label = Column(String(255), nullable=False)
    sheet_type = Column(String(64), nullable=False)
    sheet_url = Column(Text, nullable=False)
    spreadsheet_id = Column(String(255), nullable=False)
    sheet_name = Column(String(255), nullable=False)
    column_mappings = Column(JSON, nullable=False, default=dict)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    tournament = relationship("Tournament", back_populates="sheet_configs")

    __table_args__ = (
        UniqueConstraint("tournament_id", "sheet_type", name="uq_tournament_sheet_type"),
    )


# ---------------------------------------------------------------------------
# [FUTURE] User
# ---------------------------------------------------------------------------
# class User(Base):
#     __tablename__ = "users"
#     id = Column(Integer, primary_key=True)
#     first_name = Column(String(100))
#     last_name = Column(String(100))
#     email = Column(String(255), unique=True)
#     phone = Column(String(20), nullable=True)
#     shirt_size = Column(String(10), nullable=True)
#     event_expertise_raw = Column(Text, nullable=True)
#     hashed_password = Column(String(255), nullable=True)
#     created_at = Column(DateTime, default=utcnow)


# ---------------------------------------------------------------------------
# [FUTURE] Event
# ---------------------------------------------------------------------------
# class Event(Base):
#     __tablename__ = "events"
#     id = Column(Integer, primary_key=True)
#     name = Column(String(100), unique=True)
#     trial_event = Column(Boolean, default=False)


# ---------------------------------------------------------------------------
# [FUTURE] TournamentEvent
# ---------------------------------------------------------------------------
# class TournamentEvent(Base):
#     __tablename__ = "tournament_events"
#     id = Column(Integer, primary_key=True)
#     tournament_id = Column(Integer, ForeignKey("tournaments.id"))
#     event_id = Column(Integer, ForeignKey("events.id"))
#     building = Column(String(100), nullable=True)
#     room_number = Column(String(20), nullable=True)
#     floor_number = Column(Integer, nullable=True)
#     volunteers_needed = Column(Integer, default=2)


# ---------------------------------------------------------------------------
# [FUTURE] Membership
# ---------------------------------------------------------------------------
# class Membership(Base):
#     __tablename__ = "memberships"
#     id = Column(Integer, primary_key=True)
#     user_id = Column(Integer, ForeignKey("users.id"))
#     tournament_id = Column(Integer, ForeignKey("tournaments.id"))
#     tournament_event_id = Column(Integer, ForeignKey("tournament_events.id"), nullable=True)
#     status = Column(String(32), default="interested")
#     availability = Column(String(32), nullable=True)
#     lunch_order = Column(String(255), nullable=True)
#     extra_data = Column(JSON, nullable=True)
#     created_at = Column(DateTime, default=utcnow)
#     updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)