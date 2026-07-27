"""
SQLAlchemy ORM models.

NOTE: Using classic Column style (not Mapped[] annotations) for compatibility
with SQLAlchemy 2.0.36 + Python 3.13.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Integer, String, Text, Boolean, Date, DateTime, JSON,
    ForeignKey, UniqueConstraint, Column,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import relationship
from typing import Optional

from app.db.session import Base
from app.core.age import meets_age_requirement


def utcnow():
    """Timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# UserSession
# Backs authentication — replaces the previous stateless JWT so sessions can
# be listed and individually or collectively revoked (e.g. "log out
# everywhere" in account settings).
#
# token_hash uses a fast hash (SHA-256), not bcrypt — unlike VerificationToken,
# this gets checked on every authenticated request. The raw token is already
# high-entropy random, so slow adaptive hashing isn't needed here and would
# add unacceptable per-request latency. Lookup is a direct indexed equality
# match, not a loop-and-verify like consume_verification_token.
#
# Fixed 7-day expiration from creation — no sliding renewal. last_active_at
# is updated on a throttle (not every request), purely for the "active Xh
# ago" display in the settings device list — it's not used in expiration
# or validity checks, only revoked_at + expires_at are.
# ---------------------------------------------------------------------------
class UserSession(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    token_hash = Column(String(64), nullable=False, unique=True, index=True)  # SHA-256 hex digest

    user_agent = Column(String(255), nullable=True)
    ip_address = Column(String(45), nullable=True)  # long enough for IPv6

    created_at = Column(DateTime(timezone=True), default=utcnow)
    last_active_at = Column(DateTime(timezone=True), default=utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User")

# ---------------------------------------------------------------------------
# Verification Token
# Backs signup email verification, email-change, and password reset.
# One raw token is emailed to the user; only its hash is stored here.
#
# purpose: "signup_verify" | "email_change" | "password_reset"
#   new_email is only ever set for "email_change" rows.
#
# On create, any prior unconsumed row for the same (user_id, purpose) is
# marked used_at (stale-token guarding) — see app/core/verification_tokens.py.
# ---------------------------------------------------------------------------
class VerificationToken(Base):
    __tablename__ = "verification_tokens"
 
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
 
    token_hash = Column(String(255), nullable=False, index=True, unique=True)
    purpose = Column(String(32), nullable=False)  # "signup_verify" | "email_change" | "password_reset"
    new_email = Column(String(255), nullable=True)  # only set for "email_change"
 
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
 
    user = relationship("User")

# ---------------------------------------------------------------------------
# User
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
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    phone = Column(String(32), nullable=True)
    date_of_birth = Column(Date, nullable=True)
    pronouns = Column(String(100), nullable=True)

    # Auth fields
    hashed_password = Column(String(255), nullable=True)   # null = cannot log in, must reset password and verify via email
    email_verified = Column(Boolean, nullable=False, default=False)
    role = Column(String(32), nullable=False, default="user")  # "admin" | "user"
    status = Column(String(32), nullable=False, default="active")  # "active" | "invited" | "deactivated" | "locked"
    
    # if a student
    university = Column(String(255), nullable=True)
    major = Column(String(255), nullable=True)
    student_status = Column(String(255), nullable=True)       # "Undergraduate", "Graduate", "Non-Student"
    year_level = Column(Integer, nullable=True)
    graduation_year = Column(Integer, nullable=True)

    # if not a student
    employer = Column(String(255), nullable=True)
    
    has_competition_experience = Column(Boolean, nullable=True)
    has_volunteer_experience = Column(Boolean, nullable=True)
    # has_stem_experience = Column(Boolean, nullable=True)        # debatable

    shirt_size = Column(String(16), nullable=True)
    dietary_restriction = Column(String(255), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    memberships = relationship(
        "TournamentMembership", back_populates="user", cascade="all, delete-orphan"
    )
    tournaments = relationship(
        "Tournament", back_populates="owner", foreign_keys="Tournament.owner_id"
    )
    competition_experience = relationship(
        "UserCompetitionExperience",
        back_populates="user",
        foreign_keys="UserCompetitionExperience.user_id",
        cascade="all, delete-orphan"
    )
    volunteer_experience = relationship(
        "UserVolunteerExperience",
        back_populates="user",
        foreign_keys="UserVolunteerExperience.user_id",
        cascade="all, delete-orphan"
    )

# ---------------------------------------------------------------------------
# Competition Experience
# ---------------------------------------------------------------------------
class UserCompetitionExperience(Base):
    __tablename__ = "user_competition_experience"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete="CASCADE"), nullable=False)
    event_id = Column(Integer, ForeignKey('events.id', ondelete="RESTRICT"), nullable=False)
    school = Column(String(255), nullable=False)
    notes = Column(Text, nullable=True)

    user = relationship("User", back_populates="competition_experience")
    event = relationship("Event", back_populates="user_competition_experience")

# ---------------------------------------------------------------------------
# Volunteer Experience
# 
# NOTE: manual entry only, auto-populate NEXUS tournament history onto user's profile
# ---------------------------------------------------------------------------
class UserVolunteerExperience(Base):
    __tablename__ = "user_volunteer_experience"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete="CASCADE"), nullable=False)
    
    # manual add by the user
    tournament_name = Column(String(255), nullable=False)
    year = Column(Integer, nullable=False)
    event_id = Column(Integer, ForeignKey('events.id', ondelete="RESTRICT"), nullable=True)
    role = Column(String(63), nullable=False)
    
    # keys: "event", "other"
    #   - "event" only on manual add, for custom event names (doesn't exist in cannonical list)
    #   - "other" extra notes from user on their experience
    notes = Column(JSON, nullable=True)

    user = relationship("User", back_populates="volunteer_experience")
    event = relationship("Event", back_populates="user_volunteer_experience")

    

# ---------------------------------------------------------------------------
# Event Category
# ---------------------------------------------------------------------------
class EventCategory(Base):
    __tablename__ = "event_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)

    events = relationship("Event", back_populates="category", cascade="all, delete-orphan")

# ---------------------------------------------------------------------------
# Event
# ---------------------------------------------------------------------------
class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)
    category_id = Column(Integer, ForeignKey('event_categories.id'), nullable=False)

    category = relationship("EventCategory", back_populates="events")
    user_competition_experience = relationship(
        "UserCompetitionExperience",
        back_populates="event",
        foreign_keys="UserCompetitionExperience.event_id",
        passive_deletes=True,
    )
    user_volunteer_experience = relationship(
        "UserVolunteerExperience",
        back_populates="event",
        foreign_keys="UserVolunteerExperience.event_id",
        passive_deletes=True,
    )


# ---------------------------------------------------------------------------
# Tournament
# ---------------------------------------------------------------------------
class Tournament(Base):
    __tablename__ = "tournaments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    start_date = Column(DateTime(timezone=True), nullable=True)
    end_date = Column(DateTime(timezone=True), nullable=True)
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

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    owner = relationship("User", back_populates="tournaments", foreign_keys=[owner_id])
    sheet_configs = relationship(
        "SheetConfig", back_populates="tournament", cascade="all, delete-orphan"
    )
    events = relationship(
        "TournamentEvent", back_populates="tournament", cascade="all, delete-orphan"
    )
    memberships = relationship(
        "TournamentMembership", back_populates="tournament", cascade="all, delete-orphan"
    )

# ---------------------------------------------------------------------------
# Tournament Membership
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
class TournamentMembership(Base):
    __tablename__ = "tournament_memberships"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    tournament_id = Column(
        Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False
    )
    assigned_event_id = Column(
        Integer, ForeignKey("tournament_events.id", ondelete="SET NULL"), nullable=True
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
    assigned_event = relationship("TournamentEvent", back_populates="memberships")

    @hybrid_property
    def is_over_18(self) -> Optional[bool]:
        if self.user.date_of_birth is None:
            return None
        
        return meets_age_requirement(self.user.date_of_birth, self.tournament.start_date.date(), 18)
    
    @hybrid_property
    def is_over_21(self) -> Optional[bool]:
        if self.user.date_of_birth is None:
            return None
        
        return meets_age_requirement(self.user.date_of_birth, self.tournament.start_date.date(), 21)
    
    # TODO: Add @is_over_18.expression / @is_over_21.expression using date-arithmetic
    # (dob + interval '18 years' <= tournament.start_date) so tournament directors can
    # filter registrations server-side instead of client-side. Needed once dashboard
    # moves age filtering to backend / registration lists get large enough to paginate.

    __table_args__ = (
        # One membership per user per tournament
        UniqueConstraint("user_id", "tournament_id", name="uq_user_tournament"),
    )


# ---------------------------------------------------------------------------
# Tournament Event
# ---------------------------------------------------------------------------
class TournamentEvent(Base):
    __tablename__ = "tournament_events"

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
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    tournament = relationship("Tournament", back_populates="events")
    memberships = relationship("TournamentMembership", back_populates="assigned_event")

    __table_args__ = (
        UniqueConstraint("tournament_id", "name", "division", name="uq_tournament_event_division"),
    )


# ---------------------------------------------------------------------------
# SheetConfig
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