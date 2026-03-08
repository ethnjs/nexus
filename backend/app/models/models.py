"""
SQLAlchemy ORM models.

NOTE: Using classic Column style (not Mapped[] annotations) for compatibility
with SQLAlchemy 2.0.36 + Python 3.13.

STATUS LEGEND:
  [ACTIVE] — built and in use
  [FUTURE] — planned, not yet implemented
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Integer, String, Text, Boolean, DateTime, JSON,
    ForeignKey, UniqueConstraint, Column,
)
from sqlalchemy.orm import relationship
from app.db.session import Base


def utcnow():
    """Timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# [ACTIVE] Tournament
# ---------------------------------------------------------------------------
class Tournament(Base):
    __tablename__ = "tournaments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    start_date = Column(DateTime, nullable=True)
    end_date = Column(DateTime, nullable=True)
    location = Column(String(255), nullable=True)

    # [{number, label, date, start, end}, ...]
    blocks = Column(JSON, nullable=False, default=list)

    # {custom_fields: [{key, label, type}, ...]}
    volunteer_schema = Column(JSON, nullable=False, default=dict)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    sheet_configs = relationship(
        "SheetConfig", back_populates="tournament", cascade="all, delete-orphan"
    )
    events = relationship(
        "Event", back_populates="tournament", cascade="all, delete-orphan"
    )
    memberships = relationship(
        "Membership", back_populates="tournament", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# [ACTIVE] SheetConfig
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
# [ACTIVE] Event
# ---------------------------------------------------------------------------
class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(
        Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(String(255), nullable=False)
    division = Column(String(4), nullable=False)           # "B" | "C"
    event_type = Column(String(32), nullable=False, default="standard")  # "standard" | "trial"
    category = Column(String(255), nullable=True)
    building = Column(String(255), nullable=True)
    room = Column(String(64), nullable=True)
    floor = Column(String(64), nullable=True)
    volunteers_needed = Column(Integer, nullable=False, default=2)
    blocks = Column(JSON, nullable=False, default=list)    # [1,2,3,4,5,6]
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    tournament = relationship("Tournament", back_populates="events")
    memberships = relationship("Membership", back_populates="assigned_event")

    __table_args__ = (
        UniqueConstraint("tournament_id", "name", "division", name="uq_tournament_event_division"),
    )


# ---------------------------------------------------------------------------
# [ACTIVE] User
# Core volunteer identity — one record per person across all tournaments.
# Populated via Google Sheet sync. Future: self-service login.
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    phone = Column(String(32), nullable=True)
    shirt_size = Column(String(16), nullable=True)
    dietary_restriction = Column(String(255), nullable=True)
    hashed_password = Column(String(255), nullable=True)   # future login
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    memberships = relationship(
        "Membership", back_populates="user", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# [ACTIVE] Membership
# Links a User to a Tournament — their full volunteer record for that event.
# ---------------------------------------------------------------------------
class Membership(Base):
    __tablename__ = "memberships"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    tournament_id = Column(
        Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False
    )
    assigned_event_id = Column(
        Integer, ForeignKey("events.id", ondelete="SET NULL"), nullable=True
    )

    # "interested" | "confirmed" | "declined" | "assigned" | "removed"
    status = Column(String(32), nullable=False, default="interested")

    # What the TD assigned them — {"event_supervisor": [1,2,3,4,5,6], "score_counselor": [7]}
    roles = Column(JSON, nullable=True)

    # What they asked for on the form — ["event_volunteer", "general_volunteer"]
    role_preference = Column(JSON, nullable=True)

    # Specific event names they prefer — ["Boomilever", "Hovercraft"]
    event_preference = Column(JSON, nullable=True)

    # General volunteer activities they want — ["STEM Expo", "Lunch Delivery"]
    general_volunteer_interest = Column(JSON, nullable=True)

    # Normalized availability — [{date, start, end}, ...]
    # Parsed from form at sync time to match block format for easy comparison
    availability = Column(JSON, nullable=True)

    lunch_order = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)

    # Catch-all for tournament-specific fields defined in volunteer_schema
    extra_data = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    user = relationship("User", back_populates="memberships")
    tournament = relationship("Tournament", back_populates="memberships")
    assigned_event = relationship("Event", back_populates="memberships")

    __table_args__ = (
        # One membership per user per tournament
        UniqueConstraint("user_id", "tournament_id", name="uq_user_tournament"),
    )