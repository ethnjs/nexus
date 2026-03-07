"""
SQLAlchemy ORM models.

NOTE: Using classic Column style (not Mapped[] annotations) for compatibility
with SQLAlchemy 2.0.36 + Python 3.13.

STATUS LEGEND:
  [BETA]   — built and active now
  [FUTURE] — defined for schema planning, migrations will add these later
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
# [BETA] Tournament
# ---------------------------------------------------------------------------
class Tournament(Base):
    __tablename__ = "tournaments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)

    # Multi-day tournaments (e.g. nationals spans multiple days)
    start_date = Column(DateTime, nullable=True)
    end_date = Column(DateTime, nullable=True)

    location = Column(String(255), nullable=True)

    # Tournament time blocks — [{number, label, start, end}, ...]
    # Blocks 7+ can represent post-competition slots (scoring, awards)
    blocks = Column(JSON, nullable=False, default=list)

    # Lazily-built custom field definitions for volunteer data unique to this tournament
    # {"custom_fields": [{"key": "transportation", "label": "...", "type": "string"}, ...]}
    volunteer_schema = Column(JSON, nullable=False, default=dict)

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

    # "interest" | "confirmation" — plain string, not enum, no migration needed
    sheet_type = Column(String(64), nullable=False)

    sheet_url = Column(Text, nullable=False)
    spreadsheet_id = Column(String(255), nullable=False)
    sheet_name = Column(String(255), nullable=False)

    # JSON: raw column header → known DB field name
    # e.g. {"Email Address": "email", "Q3: Shirt size?": "shirt_size"}
    # "__ignore__" means skip this column on import
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
# A volunteer. Populated via Google Sheet sync for beta.
# Future: can log in and manage their own preferences.
# ---------------------------------------------------------------------------
# class User(Base):
#     __tablename__ = "users"
#     id = Column(Integer, primary_key=True)
#     first_name = Column(String(100))
#     last_name = Column(String(100))
#     email = Column(String(255), unique=True, index=True)
#     phone = Column(String(20), nullable=True)
#     shirt_size = Column(String(10), nullable=True)
#     dietary_restriction = Column(String(255), nullable=True)
#     university = Column(String(255), nullable=True)    # employer or university
#     age_verified = Column(Boolean, nullable=True)
#     # Science Olympiad background
#     scioly_competed = Column(Boolean, nullable=True)
#     scioly_competed_events = Column(Text, nullable=True)   # raw text from form
#     scioly_volunteered = Column(Boolean, nullable=True)
#     scioly_experience = Column(Text, nullable=True)        # free text expertise desc
#     event_expertise = Column(Text, nullable=True)          # comma-separated events
#     # Logistics
#     transportation = Column(String(255), nullable=True)    # how they're getting there
#     is_driver = Column(Boolean, default=False)             # derived from transportation
#     carpool_seats = Column(Integer, nullable=True)         # how many people they can take
#     hashed_password = Column(String(255), nullable=True)   # future login
#     created_at = Column(DateTime, default=utcnow)
#     updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


# ---------------------------------------------------------------------------
# [FUTURE] Event
# Generic Science Olympiad event (Circuit Lab, Boomilever, etc.)
# Also used for non-event volunteer slots (Stem Expo, Opening Ceremony)
# ---------------------------------------------------------------------------
# class Event(Base):
#     __tablename__ = "events"
#     id = Column(Integer, primary_key=True)
#     name = Column(String(100), unique=True)
#     trial_event = Column(Boolean, default=False)
#     # "event" | "general" — distinguishes science events from volunteer activity slots
#     event_type = Column(String(32), default="event")


# ---------------------------------------------------------------------------
# [FUTURE] TournamentEvent
# Links an Event to a Tournament with location + staffing info.
# Used for both science events (room/floor) and general volunteer slots.
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
#     # Which day(s) of a multi-day tournament this event runs
#     event_date = Column(DateTime, nullable=True)


# ---------------------------------------------------------------------------
# [FUTURE] Membership
# Links a User to a Tournament — their full volunteer record.
# ---------------------------------------------------------------------------
# class Membership(Base):
#     __tablename__ = "memberships"
#     id = Column(Integer, primary_key=True)
#     user_id = Column(Integer, ForeignKey("users.id"))
#     tournament_id = Column(Integer, ForeignKey("tournaments.id"))
#     tournament_event_id = Column(Integer, ForeignKey("tournament_events.id"), nullable=True)
#     # "interested" | "confirmed" | "declined" | "assigned"
#     status = Column(String(32), default="interested")
#     # Per-tournament preferences
#     role_preference = Column(String(64), nullable=True)    # "event_volunteer,general_volunteer"
#     event_preference = Column(Text, nullable=True)         # raw form string of preferred events
#     general_volunteer_interest = Column(Text, nullable=True) # preferred general activities
#     availability = Column(JSON, nullable=True)             # {time_block: yes/no} per slot
#     conflict_of_interest = Column(Text, nullable=True)
#     limitations = Column(Text, nullable=True)              # physical/accessibility notes
#     lunch_order = Column(String(255), nullable=True)
#     notes = Column(Text, nullable=True)
#     # Flexible escape hatch for unique per-tournament fields not in KNOWN_FIELDS
#     extra_data = Column(JSON, nullable=True)
#     created_at = Column(DateTime, default=utcnow)
#     updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)