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

    # {
    #   custom_fields: [{key, label, type}, ...],
    #   positions: [{key, label, permissions: [...]}, ...]
    # }
    # Positions are auto-populated from DEFAULT_POSITIONS on tournament create.
    # TDs can customise per-tournament at any time.
    volunteer_schema = Column(JSON, nullable=False, default=dict)

    # The user who created this tournament.
    # Always has a membership with positions=["tournament_director"].
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    owner = relationship("User", back_populates="tournaments", foreign_keys=[owner_id])
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
# [ACTIVE] User
# Core identity — volunteers, TDs, and admins all live here.
#
# role = "admin" | "user"
#   "admin" — superuser, bypasses all tournament-level permission checks.
#             Used for testing and platform management. Can still hold
#             memberships in tournaments like any other user.
#   "user"  — everyone else. Tournament-level access is determined entirely
#             by Membership.positions and the permissions defined in that
#             tournament's volunteer_schema.
#
# Volunteers synced from sheets have hashed_password=None and cannot log in
# until the volunteer login phase is built.
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    phone = Column(String(32), nullable=True)
    shirt_size = Column(String(16), nullable=True)
    dietary_restriction = Column(String(255), nullable=True)
    university = Column(String(255), nullable=True)
    major = Column(String(255), nullable=True)
    employer = Column(String(255), nullable=True)

    # Auth fields
    hashed_password = Column(String(255), nullable=True)   # null = cannot log in
    role = Column(String(32), nullable=False, default="user")  # "admin" | "user"
    is_active = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    memberships = relationship(
        "Membership", back_populates="user", cascade="all, delete-orphan"
    )
    tournaments = relationship(
        "Tournament", back_populates="owner", foreign_keys="Tournament.owner_id"
    )


# ---------------------------------------------------------------------------
# [ACTIVE] Membership
# Links a User to a Tournament — their full volunteer record for that event.
#
# positions: list of position keys (e.g. ["tournament_director", "test_writer"])
#   Drives both the user's title and their system permissions within this
#   tournament. Position definitions (including permissions) live in
#   Tournament.volunteer_schema["positions"] and can be customised per-tournament.
#
# schedule: day-of block assignments (e.g. [{"block": 1, "duty": "event_supervisor"}])
#   Only populated for volunteers with day-of duties. One entry per block.
#   Separate from positions — a volunteer_coordinator might be an event_supervisor
#   during competition blocks.
#
# Tournament-specific free-form data (e.g. general_volunteer_interest, transportation,
# carpool_seats, t-shirt preferences, etc.) lives in extra_data. The keys and labels
# are defined per-tournament in Tournament.volunteer_schema["custom_fields"], making
# the system flexible for any tournament's arbitrary form data.
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

    # Title(s) + permission level within this tournament.
    # List of position keys defined in tournament.volunteer_schema["positions"].
    # e.g. ["lead_event_supervisor", "test_writer"]
    positions = Column(JSON, nullable=True)

    # Day-of block schedule — [{block: int, duty: str}, ...]
    # One entry per block. duty is a free string (typically a position key).
    # e.g. [{"block": 1, "duty": "event_supervisor"}, {"block": 7, "duty": "scoring"}]
    schedule = Column(JSON, nullable=True)

    # Volunteer availability/assignment status
    # "interested" | "confirmed" | "declined" | "assigned" | "removed"
    status = Column(String(32), nullable=False, default="interested")

    # What they asked for on the form — ["event_volunteer", "general_volunteer"]
    role_preference = Column(JSON, nullable=True)

    # Specific event names they prefer — ["Boomilever", "Hovercraft"]
    event_preference = Column(JSON, nullable=True)

    # Normalized availability — [{date, start, end}, ...]
    # Parsed from form at sync time to match block format for easy comparison
    availability = Column(JSON, nullable=True)

    lunch_order = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)

    # Catch-all for tournament-specific fields defined in volunteer_schema.custom_fields.
    # Anything that doesn't map to a standard field lives here — e.g. transportation,
    # carpool_seats, general_volunteer_interest, dietary restrictions override, etc.
    # Keys match the custom_field.key defined in the tournament's volunteer_schema.
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
    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    tournament = relationship("Tournament", back_populates="sheet_configs")


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