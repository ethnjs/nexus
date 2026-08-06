"""
SQLAlchemy ORM models.

NOTE: Using classic Column style (not Mapped[] annotations) for compatibility
with SQLAlchemy 2.0.36 + Python 3.13.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Integer, String, Text, Boolean, Date, DateTime, JSON,
    ForeignKey, UniqueConstraint, CheckConstraint, Column,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import relationship, validates
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
# purpose: "signup_verify" | "email_change" | "password_reset" | "email_change_revert"
#   new_email is only ever set for "email_change" and "email_change_revert" rows.
#   For "email_change_revert" it's overloaded to mean "the email this token
#   reverts TO" (i.e. the pre-takeover address), not "the new email".
#
# On create, any prior unconsumed row for the same (user_id, purpose) is
# marked used_at (stale-token guarding) — see app/core/verification_tokens.py.
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
# University
# A master lookup registry of standardized post-secondary institutions.
#
# Serves as the single source of truth across the platform to eliminate free-text
# inconsistency (e.g., preventing "OSU" vs "Ohio State University"). Both User
# profiles and Tournaments reference this table to establish structural ties.
#
# unique constraints:
#   name: The full official name of the institution (e.g., "Stanford University").
#
# nullable fields:
#   abbreviation: Common shorthand or acronym (e.g., "MIT", "UCB") used for
#     compact UI rendering, dashboard badges, and quick search indexing.
#   location: General geographic descriptor (e.g., "Berkeley, CA") used to provide
#     context on proximity for tournament planning or regional chapter groupings.
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
# User
# Core identity — volunteers, TDs, and admins all live here.
#
# role = "admin" | "user"
#   "admin" — superuser, bypasses all tournament-level permission checks.
#             Used for testing and platform management. Can still hold
#             memberships in tournaments like any other user.
#   "user"  — everyone else. Tournament-level access is determined by
#             TournamentMembershipRole assignments and the permissions
#             defined on each TournamentRole.
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
# Tournament
# ---------------------------------------------------------------------------
class Tournament(Base):
    __tablename__ = "tournaments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    start_date = Column(DateTime(timezone=True), nullable=True)
    end_date = Column(DateTime(timezone=True), nullable=True)
    university_id = Column(Integer, ForeignKey("universities.id"), nullable=True)
    location = Column(String(255), nullable=True)

    # The user who created this tournament.
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # TD-controlled — whether this tournament shows up in the public directory
    # (as upcoming, not necessarily verified). False = invite-only via
    # JoinCode.
    is_public = Column(Boolean, nullable=False, default=False)

    # Platform-admin-only — manually flipped after reviewing a tournament.
    # Never settable by the tournament's own TD. Independent of is_public: a
    # tournament can be public but not yet verified.
    is_verified = Column(Boolean, nullable=False, default=False)

    # Gates join/visibility behavior — load-bearing, unlike the informational
    # deadlines that live in TournamentDeadline.
    registration_opens_at = Column(DateTime(timezone=True), nullable=True)

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

    # Schema Validator: at least one of "university_id" or "location" must be set
    @validates("university_id", "location")
    def validate_tournament_source(self, key, value):
        # Determine the other field's value
        univ = value if key == "university_id" else self.university_id
        loc = value if key == "location" else self.location

        # If both are None, raise a validation error. At least one must be set.
        if not univ and not loc:
            raise ValueError("Tournament must have either a university_id or a location.")

        return value

# ---------------------------------------------------------------------------
# Tournament Membership
# Links a User to a Tournament — their full volunteer record for that event.
#
# Title(s) + permission level within this tournament are now driven by
# TournamentMembershipRole (see `roles` relationship below), not a JSON
# column — see TournamentRole/TournamentMembershipRole.
#
# schedule: day-of block assignments (e.g. [{"block": 1, "duty": "event_supervisor"}])
#   Only populated for volunteers with day-of duties. One entry per block.
#   duty is a free string, typically a role key.
#
# Tournament-specific free-form data (e.g. general_volunteer_interest, transportation,
# carpool_seats, t-shirt preferences, etc.) lives in extra_data. There's no
# structured schema for these keys currently — that's redesigned later as
# part of a separate forms system.
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

    # How this membership was created — "join_code" | "public" | "manual"
    # ("manual" = staff added directly, incl. owner-on-creation and sync
    # import; slated for removal once manual add-by-staff goes away)
    source = Column(String(32), nullable=False)

    # Which code was redeemed, if source == "join_code". Null for public
    # self-joins. SET NULL on code deletion so history survives the code.
    join_code_id = Column(
        Integer, ForeignKey("join_codes.id", ondelete="SET NULL"), nullable=True
    )

    # Day-of block schedule — [{block: int, duty: str}, ...]
    # One entry per block. duty is a free string (typically a role key).
    # e.g. [{"block": 1, "duty": "event_supervisor"}, {"block": 7, "duty": "scoring"}]
    schedule = Column(JSON, nullable=True)

    # "interested" | "confirmed"
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

    # Catch-all for tournament-specific fields — e.g. transportation,
    # carpool_seats, general_volunteer_interest, dietary restrictions
    # override, etc. No structured schema for these keys currently; that's
    # redesigned later as part of a separate forms system.
    extra_data = Column(JSON, nullable=True)

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
    
    # TODO: Add @is_over_18.expression / @is_over_21.expression using date-arithmetic
    # (dob + interval '18 years' <= tournament.start_date) so tournament directors can
    # filter registrations server-side instead of client-side. Needed once dashboard
    # moves age filtering to backend / registration lists get large enough to paginate.

    __table_args__ = (
        # One membership per user per tournament
        UniqueConstraint("user_id", "tournament_id", name="uq_user_tournament"),
    )


# ---------------------------------------------------------------------------
# Tournament Role
# Relational replacement for Tournament.volunteer_schema["positions"]. Each row
# is one role definable by a TD for their tournament (e.g. "Tournament
# Director", "Test Writer") carrying a fixed set of permission strings and a
# rank used to bound staff-management actions (see TournamentMembershipRole, Step 7 of
# the roles/permissions rebuild).
# ---------------------------------------------------------------------------
class TournamentRole(Base):
    __tablename__ = "tournament_roles"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False)
    label = Column(String(255), nullable=False)        # human-readable name

    # List of permission strings from ALL_PERMISSIONS in core/permissions.py.
    # Kept as JSON rather than a junction table deliberately — permissions are a
    # small, fixed, code-defined enum (adding one requires a deploy, not a runtime
    # action), so there's no relational benefit to normalizing them, and a junction
    # table would add a join to the permission-check hot path for no query gain.
    permissions = Column(JSON, nullable=False, default=list)

    # Lower number = higher authority. Ties are allowed and expected (e.g. the
    # four coordinator roles all share a rank). Used to bound what a MANAGE_ROLES
    # holder can assign/remove. The tournament Owner is NOT a role and has no
    # rank; it sits structurally above rank 1.
    rank = Column(Integer, nullable=False)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    tournament = relationship("Tournament", back_populates="roles")
    memberships = relationship("TournamentMembershipRole", back_populates="role", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("tournament_id", "label", name="uq_tournament_role_label"),
    )


# ---------------------------------------------------------------------------
# Tournament Membership Role
# Join table assigning a TournamentRole to a TournamentMembership. Replacement
# for TournamentMembership.positions (JSON array of role key strings). Named
# with the "Tournament" prefix to avoid ambiguity with ChapterMembership's
# own role/permission concept.
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
# Join Code
# Invite-link mechanism shared by tournaments (is_public=False, and as an
# optional recruiting channel for public ones) and alumni chapters. Exactly
# one of tournament_id/chapter_id is set — enforced by ck_join_code_one_target
# — so `code` is globally unique and a single /join lookup can resolve which
# onboarding flow to send someone through without checking two tables.
#
# Redeeming a tournament code creates a bare TournamentMembership with no
# roles attached and status="interested" — staff assign roles afterward.
# Redeeming a chapter code creates a ChapterMembership with role="member"
# directly, since chapters don't have a staff-assignment step.
# is_active is fully manual for now; whether a code should auto-deactivate
# once a registration deadline passes is deferred.
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
# AlumniChapter
# Regional organizations or networks where alumni coordinate and connect.
#
# A chapter defines a specific geographic hub (e.g., "Bay Area"). It acts
# as the parent container for both regional leadership roles and local events.
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


# ---------------------------------------------------------------------------
# ChapterMembership
# Explicit join table managing the connection between users and chapters.
#
# Tracks the structural relationship determining which alumni belong to
# which regional hub. It provides the database anchor for user-chapter
# association, serving as the foundation for assigning leadership positions.
# ---------------------------------------------------------------------------

class ChapterMembership(Base):
    __tablename__ = "chapter_memberships"

    id = Column(Integer, primary_key=True)
    chapter_id = Column(Integer, ForeignKey("alumni_chapters.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    # unique=True on user_id, so users can only join one chapter at DataBase level
    role = Column(String(32), nullable=False, default="member")
    # "lead", | "officer" | "member"
    joined_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    alumni_chapter = relationship("AlumniChapter", back_populates="chapter_memberships")
    user = relationship("User", back_populates="chapter_membership")



# ---------------------------------------------------------------------------
# TournamentChapter
# Junction table mapping AlumniChapters to affiliated Tournaments.
#
# Enables a many-to-many relationship tracking which alumni chapters are
# supporting, hosting, or participating in specific Science Olympiad tournaments.
# ---------------------------------------------------------------------------

class TournamentChapter(Base):
    __tablename__ = "tournament_chapters"

    tournament_id = Column(Integer, ForeignKey("tournaments.id"), primary_key=True)
    chapter_id = Column(Integer, ForeignKey("alumni_chapters.id"), primary_key=True)

    # Relationships
    tournament = relationship("Tournament", back_populates="tournament_chapters")
    chapter = relationship("AlumniChapter", back_populates="tournament_chapters")
