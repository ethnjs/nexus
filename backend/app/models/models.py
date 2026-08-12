"""
SQLAlchemy ORM models.

NOTE: Using classic Column style (not Mapped[] annotations) for compatibility
with SQLAlchemy 2.0.36 + Python 3.13.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Integer, String, Text, Boolean, Date, DateTime, JSON,
    ForeignKey, UniqueConstraint, CheckConstraint, Column, event,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import relationship
from typing import Optional

from app.db.session import Base
from app.core.age import meets_age_requirement
from pydantic import field_validator


def utcnow():
    """Timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# UserSession — backs auth, lets sessions be listed/revoked individually.
# token_hash is SHA-256 (fast, checked every request), not bcrypt.
# last_active_at is display-only, not used in validity checks.
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
# VerificationToken — backs signup verify, email-change, password reset.
# Only the hash is stored; raw token is emailed. new_email is set for
# email_change* purposes only (for revert, it's the address to revert TO).
# ---------------------------------------------------------------------------
class VerificationToken(Base):
    __tablename__ = "verification_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    token_hash = Column(String(255), nullable=False, index=True, unique=True)
    purpose = Column(String(32), nullable=False)  # "signup_verify" | "email_change" | "password_reset" | "email_change_revert"
    new_email = Column(String(255), nullable=True)  # "email_change": new address. "email_change_revert": address to revert TO (old address).
 
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
 
    user = relationship("User")

# ---------------------------------------------------------------------------
# University — canonical lookup table so free-text names ("OSU" vs "Ohio
# State University") don't fragment. Referenced by both User and Tournament.
# ---------------------------------------------------------------------------
class University(Base):
    __tablename__ = "universities"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    abbreviation = Column(String(32), nullable=True)    # e.g. "USC", "UCLA", "UCI"
    location = Column(String(255), nullable=True)       # e.g. "Los Angeles, CA"

    # Relationships
    tournaments = relationship("Tournament", back_populates="university")
    users = relationship("User", back_populates="university")
    alumni_chapter = relationship("AlumniChapter", back_populates="university", uselist=False)


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
# User — core identity for volunteers, TDs, and admins.
# role="admin" bypasses all tournament permission checks; "user" is gated by
# TournamentMembershipRole. Sheet-synced volunteers have hashed_password=None.
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
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
    university_id = Column(Integer, ForeignKey("universities.id"), nullable=True)
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
    university = relationship("University", back_populates="users")
    chapter_membership = relationship("ChapterMembership", back_populates="user", uselist=False)
    join_codes = relationship("JoinCode", back_populates="creator")
    created_forms = relationship("Form", back_populates="creator")

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
# UserVolunteerExperience — manual entry only for now
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
    
    notes = Column(JSON, nullable=True)  # {"event": custom name, "other": free notes}

    user = relationship("User", back_populates="volunteer_experience")
    event = relationship("Event", back_populates="user_volunteer_experience")



# ---------------------------------------------------------------------------
# Tournament
# ---------------------------------------------------------------------------
class Tournament(Base):
    __tablename__ = "tournaments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)                 # excludes year, e.g. "Science Olympiad Invitational"
    short_name = Column(String(64), nullable=True)              # includes abbreviation, e.g. "SoCal", "OC", "LA"
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    university_id = Column(Integer, ForeignKey("universities.id"), nullable=True)
    location = Column(String(255), nullable=True)

    state = Column(String(32), nullable=False)
    level = Column(String(32), nullable=False)                  # "regionals" | "state" | "nationals" | "invitational"
    division = Column(JSON, nullable=False, default=list)       # "A" | "B" | "C"

    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # creator

    # TD-controlled — shows in the public directory. False = invite-only.
    is_public = Column(Boolean, nullable=False, default=False)

    # Admin-only, independent of is_public — a tournament can be public but
    # not yet verified.
    is_verified = Column(Boolean, nullable=False, default=False)

    # Read-only history — blocks writes, drops from public listing. Owner can
    # unarchive; admin-only once past end_date. Independent of is_public.
    is_archived = Column(Boolean, nullable=False, default=False)

    # Set on a past-due unarchive so the daily job (tournament/scheduler.py)
    # won't re-archive it. Cleared on re-archive.
    archive_override_at = Column(DateTime(timezone=True), nullable=True)

    registration_opens_at = Column(DateTime(timezone=True), nullable=True)  # gates joining, unlike TournamentDeadline

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
    university = relationship("University", back_populates="tournaments")
    tournament_chapters = relationship("TournamentChapter", back_populates="tournament")
    roles = relationship("TournamentRole", back_populates="tournament", cascade="all, delete-orphan")
    join_codes = relationship("JoinCode", back_populates="tournament", cascade="all, delete-orphan")
    audit_log = relationship("AuditLogEntry", back_populates="tournament", cascade="all, delete-orphan")
    forms = relationship("Form", back_populates="tournament", cascade="all, delete-orphan")


# Exactly one of university_id/location (XOR). Checked at flush, not
# per-attribute, so swapping one for the other doesn't hit a false-invalid
# intermediate state.
@event.listens_for(Tournament, "before_insert")
@event.listens_for(Tournament, "before_update")
def _validate_tournament_source(mapper, connection, target: Tournament):
    univ = bool(target.university_id)
    loc = bool(target.location)
    if not univ and not loc:
        raise ValueError("Tournament must have either a university_id or a location.")
    if univ and loc:
        raise ValueError("Tournament must have only one of university_id or location, not both.")

# ---------------------------------------------------------------------------
# TournamentMembership — links a User to a Tournament (their volunteer
# record). Roles/permissions come from TournamentMembershipRole, not a
# column here. Misc form data lives in extra_data (no schema yet).
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

    source = Column(String(32), nullable=False)  # "join_code" | "public" | "manual"

    # Join code redeemed, if source=="join_code". SET NULL on code delete so
    # history survives.
    join_code_id = Column(
        Integer, ForeignKey("join_codes.id", ondelete="SET NULL"), nullable=True
    )

    schedule = Column(JSON, nullable=True)  # [{block, duty}, ...] — day-of assignments

    # "interested" | "confirmed"
    status = Column(String(32), nullable=False, default="interested")

    # What they asked for on the form — ["event_volunteer", "general_volunteer"]
    role_preference = Column(JSON, nullable=True)

    # Specific event names they prefer — ["Boomilever", "Hovercraft"]
    event_preference = Column(JSON, nullable=True)

    availability = Column(JSON, nullable=True)  # [{date, start, end}, ...], normalized to block format
    lunch_order = Column(JSON, nullable=True)   # dict for structured orders, or a plain string

    notes = Column(Text, nullable=True)
    extra_data = Column(JSON, nullable=True)  # catch-all form fields, no schema yet

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    user = relationship("User", back_populates="memberships")
    tournament = relationship("Tournament", back_populates="memberships")
    assigned_event = relationship("TournamentEvent", back_populates="memberships")
    roles = relationship("TournamentMembershipRole", back_populates="membership", cascade="all, delete-orphan")
    join_code = relationship("JoinCode")

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
    
    # TODO: add .expression variants for server-side age filtering once needed.

    __table_args__ = (
        UniqueConstraint("user_id", "tournament_id", name="uq_user_tournament"),
    )


# ---------------------------------------------------------------------------
# TournamentRole — one row per TD-definable role (e.g. "Test Writer"),
# carrying permission strings and a rank that bounds staff-management actions.
# ---------------------------------------------------------------------------
class TournamentRole(Base):
    __tablename__ = "tournament_roles"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False)
    label = Column(String(255), nullable=False)        # human-readable name

    # Strings from ALL_PERMISSIONS (core/permissions.py). JSON, not a junction
    # table — permissions are a small fixed enum, no relational benefit.
    permissions = Column(JSON, nullable=False, default=list)

    # Lower = higher authority; ties allowed. Bounds what MANAGE_ROLES can
    # touch. Owner isn't a role — sits above rank 1 structurally.
    rank = Column(Integer, nullable=False)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    tournament = relationship("Tournament", back_populates="roles")
    memberships = relationship("TournamentMembershipRole", back_populates="role", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("tournament_id", "label", name="uq_tournament_role_label"),
    )


# ---------------------------------------------------------------------------
# TournamentMembershipRole — join table: TournamentRole <-> TournamentMembership.
# ---------------------------------------------------------------------------
class TournamentMembershipRole(Base):
    __tablename__ = "tournament_membership_roles"

    id = Column(Integer, primary_key=True, index=True)
    membership_id = Column(Integer, ForeignKey("tournament_memberships.id", ondelete="CASCADE"), nullable=False)
    role_id = Column(Integer, ForeignKey("tournament_roles.id", ondelete="CASCADE"), nullable=False)

    membership = relationship("TournamentMembership", back_populates="roles")
    role = relationship("TournamentRole", back_populates="memberships")

    __table_args__ = (
        UniqueConstraint("membership_id", "role_id", name="uq_membership_role"),
    )


# ---------------------------------------------------------------------------
# JoinCode — shared invite-link mechanism for tournaments and chapters.
# Exactly one of tournament_id/chapter_id is set (ck_join_code_one_target),
# so a single /join lookup resolves the right onboarding flow.
# ---------------------------------------------------------------------------
class JoinCode(Base):
    __tablename__ = "join_codes"

    id = Column(Integer, primary_key=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=True)
    chapter_id = Column(Integer, ForeignKey("alumni_chapters.id", ondelete="CASCADE"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    code = Column(String(8), unique=True, nullable=False)
    label = Column(String(255), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    use_count = Column(Integer, nullable=False, default=0)

    __table_args__ = (
        CheckConstraint(
            "(tournament_id IS NOT NULL) != (chapter_id IS NOT NULL)",
            name="ck_join_code_one_target",
        ),
    )

    tournament = relationship("Tournament", back_populates="join_codes")
    alumni_chapter = relationship("AlumniChapter", back_populates="join_codes")
    creator = relationship("User", back_populates="join_codes")


# ---------------------------------------------------------------------------
# Audit Log Entry
# Per-tournament audit trail
# actor_id includes the Owner with no special case (Owner isn't a role, but
# still shows up as the actor on rows they trigger).
# ---------------------------------------------------------------------------
class AuditLogEntry(Base):
    __tablename__ = "audit_log_entries"

    id = Column(Integer, primary_key=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String(64), nullable=False)
    target_type = Column(String(64), nullable=True)   # e.g. "membership", "role", "join_code"
    target_id = Column(Integer, nullable=True)
    extra_data = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    tournament = relationship("Tournament", back_populates="audit_log")


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


# ---------------------------------------------------------------------------
# AlumniChapter — a regional hub (e.g. "Bay Area") for alumni coordination.
# ---------------------------------------------------------------------------

class AlumniChapter(Base):
    __tablename__ = "alumni_chapters"

    id = Column(Integer,  primary_key=True)
    name = Column(String(255), nullable=False)
    university_id = Column(Integer, ForeignKey("universities.id"), nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    university = relationship("University", back_populates="alumni_chapter")
    chapter_memberships = relationship("ChapterMembership", back_populates="alumni_chapter", cascade="all, delete-orphan")
    join_codes = relationship("JoinCode", back_populates="alumni_chapter", cascade="all, delete-orphan")
    tournament_chapters = relationship("TournamentChapter", back_populates="chapter")
    forms = relationship("Form", back_populates="chapter", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# ChapterMembership — join table, User <-> AlumniChapter.
# ---------------------------------------------------------------------------

class ChapterMembership(Base):
    __tablename__ = "chapter_memberships"

    id = Column(Integer, primary_key=True)
    chapter_id = Column(Integer, ForeignKey("alumni_chapters.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)  # one chapter per user
    role = Column(String(32), nullable=False, default="member")  # "lead" | "officer" | "member"
    joined_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    alumni_chapter = relationship("AlumniChapter", back_populates="chapter_memberships")
    user = relationship("User", back_populates="chapter_membership")



# ---------------------------------------------------------------------------
# TournamentChapter — junction table, AlumniChapter <-> Tournament (many-to-many).
# ---------------------------------------------------------------------------

class TournamentChapter(Base):
    __tablename__ = "tournament_chapters"

    tournament_id = Column(Integer, ForeignKey("tournaments.id"), primary_key=True)
    chapter_id = Column(Integer, ForeignKey("alumni_chapters.id"), primary_key=True)

    # Relationships
    tournament = relationship("Tournament", back_populates="tournament_chapters")
    chapter = relationship("AlumniChapter", back_populates="tournament_chapters")

class Form(Base):
    __tablename__ = "forms"

    id = Column(Integer, primary_key=True, index=True)
    owner_type = Column(String(16), nullable=False)   # "tournament" | "chapter"
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=True)
    chapter_id = Column(Integer, ForeignKey("alumni_chapters.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(255), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    tournament = relationship("Tournament", back_populates="forms")
    chapter = relationship("AlumniChapter", back_populates="forms")
    creator = relationship("User", back_populates="created_forms")
    fields = relationship("FormField", back_populates="form", cascade="all, delete-orphan", order_by="FormField.order")

    __table_args__ = (
        CheckConstraint(
            "(owner_type = 'tournament' AND tournament_id IS NOT NULL AND chapter_id IS NULL) OR "
            "(owner_type = 'chapter' AND chapter_id IS NOT NULL AND tournament_id IS NULL)",
            name="ck_form_owner_exclusive",
        ),
    )


class FormField(Base):
    __tablename__ = "form_fields"

    id = Column(Integer, primary_key=True, index=True)
    form_id = Column(Integer, ForeignKey("forms.id", ondelete="CASCADE"), nullable=False)
    order = Column(Integer, nullable=False)
    label = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    question_type = Column(String(32), nullable=False)
    # short_text | paragraph | single_select_radio | single_select_dropdown
    # | multi_select | ranked_choice | grid | shift_select | page_break
    
    field_key = Column(String(64), nullable=False)

    config = Column(JSON, nullable=True)
    # For plain choice questions: {"options": [{"id": "opt_1", "label": "...",
    #   "archived": false, "next_section_id": null, "allow_other": false}, ...]}
    # For "grid": {"rows": [{"id","label"}...], "columns": [{"id","label"}...],
    #   "column_selection": "single"|"multiple"}
    # For "page_break": unused, null

    required = Column(Boolean, nullable=False, default=False)
    is_archived = Column(Boolean, nullable=False, default=False)

    form = relationship("Form", back_populates="fields")

    __table_args__ = (
        UniqueConstraint("form_id", "field_key", name="uq_form_field_key"),
    )

    @field_validator("field_key")
    @classmethod
    def validate_field_key(cls, v: str) -> str:
        if not v.replace("_", "").isalnum():
            raise ValueError("field_key must be snake_case alphanumeric")
        return v