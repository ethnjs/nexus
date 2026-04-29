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
    start_date = Column(DateTime(timezone=True), nullable=True)
    end_date = Column(DateTime(timezone=True), nullable=True)
    location = Column(String(255), nullable=True)

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

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

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
    time_blocks = relationship(
        "TimeBlock", back_populates="tournament", cascade="all, delete-orphan"
    )
    categories = relationship(
        "TournamentCategory", back_populates="tournament", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# [ACTIVE] TimeBlock
# ---------------------------------------------------------------------------
class TimeBlock(Base):
    __tablename__ = "time_blocks"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(
        Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False
    )
    label = Column(String(255), nullable=False)
    date = Column(String(10), nullable=False)   # "YYYY-MM-DD"
    start = Column(String(5), nullable=False)    # "HH:MM" 24hr
    end = Column(String(5), nullable=False)      # "HH:MM" 24hr

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    tournament = relationship("Tournament", back_populates="time_blocks")
    events = relationship(
        "Event", secondary="event_time_blocks", back_populates="time_blocks"
    )


# ---------------------------------------------------------------------------
# [ACTIVE] EventTimeBlock (Association Table)
# ---------------------------------------------------------------------------
class EventTimeBlock(Base):
    __tablename__ = "event_time_blocks"

    event_id = Column(
        Integer, ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    time_block_id = Column(
        Integer, ForeignKey("time_blocks.id", ondelete="CASCADE"), primary_key=True
    )


# ---------------------------------------------------------------------------
# [ACTIVE] TournamentCategory
# ---------------------------------------------------------------------------
class TournamentCategory(Base):
    __tablename__ = "tournament_categories"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(
        Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(String(255), nullable=False)
    is_custom = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime, default=utcnow)

    tournament = relationship("Tournament", back_populates="categories")
    events = relationship("Event", back_populates="category")

    __table_args__ = (
        UniqueConstraint("tournament_id", "name", name="uq_tournament_category_name"),
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

    # Promoted from extra_data — user-level attributes that travel across tournaments
    student_status = Column(String(255), nullable=True)      # e.g. "1st Year", "Graduate", "Alumni"
    competition_exp = Column(Text, nullable=True)             # free-form competition experience
    volunteering_exp = Column(Text, nullable=True)            # free-form volunteering experience

    # Auth fields
    hashed_password = Column(String(255), nullable=True)   # null = cannot log in
    role = Column(String(32), nullable=False, default="user")  # "admin" | "user"
    is_active = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

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
# schedule: day-of block assignments (e.g. [{"time_block_id": 1, "duty": "event_supervisor"}])
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

    # Title(s) + permission level within this tournament.
    # List of position keys defined in tournament.volunteer_schema["positions"].
    # e.g. ["lead_event_supervisor", "test_writer"]
    positions = Column(JSON, nullable=True)

    # Day-of block schedule — [{time_block_id: int, duty: str}, ...]
    # One entry per block. duty is a free string (typically a position key).
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

    # Lunch order — stored as JSON dict for structured orders
    # e.g. {"protein": "Chicken", "drink": "Coke"}
    # or simple string for single-field lunch orders
    lunch_order = Column(JSON, nullable=True)

    notes = Column(Text, nullable=True)

    # Catch-all for tournament-specific fields defined in volunteer_schema.custom_fields.
    # Anything that doesn't map to a standard field lives here — e.g. transportation,
    # carpool_seats, general_volunteer_interest, dietary restrictions override, etc.
    # Keys match the custom_field.key defined in the tournament's volunteer_schema.
    extra_data = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    user = relationship("User", back_populates="memberships")
    tournament = relationship("Tournament", back_populates="memberships")
    events = relationship(
        "Event", secondary="membership_events", back_populates="memberships"
    )

    __table_args__ = (
        # One membership per user per tournament
        UniqueConstraint("user_id", "tournament_id", name="uq_user_tournament"),
    )

    # TODO(temp): remove when user account self-management is implemented
    shirt_size           = Column(String(16),  nullable=True)
    dietary_restriction  = Column(String(255), nullable=True)
    university           = Column(String(255), nullable=True)
    major                = Column(String(255), nullable=True)
    employer             = Column(String(255), nullable=True)
    student_status       = Column(String(100), nullable=True)
    competition_exp      = Column(Text,        nullable=True)
    volunteering_exp     = Column(Text,        nullable=True)


# ---------------------------------------------------------------------------
# [ACTIVE] MembershipEvent (Association Table)
# ---------------------------------------------------------------------------
class MembershipEvent(Base):
    __tablename__ = "membership_events"

    membership_id = Column(
        Integer, ForeignKey("memberships.id", ondelete="CASCADE"), primary_key=True
    )
    event_id = Column(
        Integer, ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
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
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

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
    division = Column(String(4), nullable=True)           # "B" | "C" | null
    event_type = Column(String(32), nullable=False, default="standard")  # "standard" | "trial"
    category_id = Column(
        Integer, ForeignKey("tournament_categories.id", ondelete="SET NULL"), nullable=True
    )
    building = Column(String(255), nullable=True)
    room = Column(String(64), nullable=True)
    floor = Column(String(64), nullable=True)
    volunteers_needed = Column(Integer, nullable=False, default=2)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    tournament = relationship("Tournament", back_populates="events")
    category = relationship("TournamentCategory", back_populates="events")
    time_blocks = relationship(
        "TimeBlock", secondary="event_time_blocks", back_populates="events"
    )
    memberships = relationship(
        "Membership", secondary="membership_events", back_populates="events"
    )

    __table_args__ = (
        UniqueConstraint("tournament_id", "name", "division", name="uq_tournament_event_division"),
    )