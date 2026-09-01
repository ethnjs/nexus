"""
SQLAlchemy ORM models.

NOTE: Using classic Column style (not Mapped[] annotations) for compatibility
with SQLAlchemy 2.0.36 + Python 3.13.
"""

from datetime import datetime, timezone
from nanoid import generate as generate_nanoid
from sqlalchemy import (
    Integer, String, Text, Boolean, Date, DateTime, JSON,
    ForeignKey, UniqueConstraint, CheckConstraint, Column, event, Index, text,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import relationship, validates
from typing import Optional

from app.db.session import Base
from app.core.age import meets_age_requirement


def generate_public_id() -> str:
    """12-char random string (nanoid's default alphabet is already
    URL-safe), not an auto-increment int — shared by every Form-family
    primary key (Form.id, FormField.id, FormResponse.id, FormAnswer.id) so
    they're all the same recognizable shape, the way option_id already is
    (assign_option_ids's secrets.token_hex(5)). Form.id specifically is also
    referenced directly in URLs (/forms/{id}/edit), a user-facing document
    id rather than an internal implementation detail — the others don't
    appear in a URL today, but there's no reason for them to look or behave
    differently from Form.id since nothing depends on them being sequential."""
    return generate_nanoid(size=12)


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
# SeasonEvent — admin-curated "this canonical event, in this division, is
# active this year" list. Drives the tournament events bulk-load default
# list (see TournamentEvent); independent of any single tournament.
# ---------------------------------------------------------------------------
class SeasonEvent(Base):
    __tablename__ = "season_events"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    year = Column(Integer, nullable=False)
    division = Column(String(4), nullable=False)
    is_active = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    event = relationship("Event")

    __table_args__ = (
        UniqueConstraint("event_id", "year", "division", name="uq_season_event"),
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

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

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
    form_responses = relationship("FormResponse", back_populates="user")

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

    # IANA name (e.g. "America/Los_Angeles"). Set once at creation from the
    # creator's browser timezone — immutable after, no update path.
    timezone = Column(String(64), nullable=False)

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

    # TD opt-in to collecting each age threshold. Off by default — a member
    # never has to disclose either flag unless the TD turns this on, and even
    # then only after the member explicitly consents (see
    # TournamentMembership.age_disclosure). Independent of each other: a TD
    # can collect just one.
    collect_is_over_18 = Column(Boolean, nullable=False, default=False)
    collect_is_over_21 = Column(Boolean, nullable=False, default=False)

    # Per-tournament (not per-viewer) UI display config, keyed by surface —
    # {"members_panel": {"hidden": ["track:3", "lunch_category:entree"]}, ...}.
    # Namespaced hidden-item strings (track:, lunch_category:, event_pref:,
    # form_field:) so one list covers all four kinds. No search/filtering on
    # this, so a JSON column beats a table. Unknown surface keys and unknown
    # namespaces are ignored on read, never an error — a deleted track leaves
    # a dangling "track:3" behind and that must not 500 the members page.
    display_config = Column(JSON, nullable=False, default=dict)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

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
    event_shifts = relationship("TournamentShift", back_populates="tournament", cascade="all, delete-orphan")
    tracks = relationship("TournamentTrack", back_populates="tournament", cascade="all, delete-orphan")
    forms = relationship("Form", back_populates="tournament", cascade="all, delete-orphan")
    tournament_forms = relationship("TournamentForm", back_populates="tournament", cascade="all, delete-orphan")


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
# column here.
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
    source = Column(String(32), nullable=False)  # "join_code" | "public" | "manual"

    # Join code redeemed, if source=="join_code". SET NULL on code delete so
    # history survives.
    join_code_id = Column(
        Integer, ForeignKey("join_codes.id", ondelete="SET NULL"), nullable=True
    )

    # Set once this member has answered every currently-onboarding-flagged,
    # published TournamentForm for this tournament. Permanent once set —
    # later removing/archiving an onboarding form never unsets it (a
    # shrinking requirement can only help stragglers finish, never un-onboard
    # someone already done). Adding a *new* onboarding form is the one
    # requirement change allowed to null this back out — see the
    # onboarding-forms POST route, which clears it tournament-wide.
    onboarded_at = Column(DateTime(timezone=True), nullable=True)

    # One status column, not a consented_at/declined_at pair — a pair can
    # represent "both set" (nonsensical) and something will eventually set
    # both. null = unanswered, "consented" | "declined" — one answer covers
    # both is_over_18 and is_over_21, there's no partial consent. String,
    # not an enum type, validated in the Pydantic schema — same idiom as
    # TournamentMembershipTrackStatus.status.
    age_disclosure = Column(String(32), nullable=True)
    age_disclosure_at = Column(DateTime(timezone=True), nullable=True)

    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="memberships")
    tournament = relationship("Tournament", back_populates="memberships")
    roles = relationship("TournamentMembershipRole", back_populates="membership", cascade="all, delete-orphan")
    join_code = relationship("JoinCode")
    availability_shifts = relationship("TournamentMembershipAvailability", back_populates="membership", cascade="all, delete-orphan")
    lunch_selections = relationship("TournamentMembershipLunch", back_populates="membership", cascade="all, delete-orphan")
    track_statuses = relationship("TournamentMembershipTrackStatus", back_populates="membership", cascade="all, delete-orphan")
    event_preferences = relationship("TournamentMembershipEventPreference", back_populates="membership", cascade="all, delete-orphan")

    @hybrid_property
    def is_over_18(self) -> Optional[bool]:
        if self.user.date_of_birth is None:
            return None

        return meets_age_requirement(self.user.date_of_birth, self.tournament.start_date, 18)

    @hybrid_property
    def is_over_21(self) -> Optional[bool]:
        if self.user.date_of_birth is None:
            return None

        return meets_age_requirement(self.user.date_of_birth, self.tournament.start_date, 21)

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

    # Custom (event_id-less) events only
    name = Column(String(255), nullable=True)
    division = Column(String(4), nullable=True)           # "A" | "B" | "C"
    event_type = Column(String(32), nullable=False, default="standard")  # "standard" | "trial"

    # Canonical event table link — SET NULL on delete so custom (event_id-less)
    # events are just the default, not a broken reference.
    event_id = Column(Integer, ForeignKey("events.id", ondelete="SET NULL"), nullable=True)

    building = Column(String(255), nullable=True)
    room = Column(String(64), nullable=True)
    floor = Column(String(64), nullable=True)

    volunteers_needed = Column(Integer, nullable=True)

    # Nullable — tournament planning starts before per-event times are known.
    # Frontend is expected to warn on unset times, not block on them here.
    start_time = Column(DateTime(timezone=True), nullable=True)
    end_time = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    tournament = relationship("Tournament", back_populates="events")
    event = relationship("Event")
    shifts = relationship(
        "TournamentShift", secondary="tournament_event_shifts", back_populates="tournament_events"
    )

    @property
    def display_name(self) -> str | None:
        """The name to show for this event. `name` is only populated for
        custom (event_id-less) events — a catalog-linked one carries its name
        on the joined Event row, so reading `.name` directly renders every
        catalog event nameless."""
        return self.name or (self.event.name if self.event else None)

    __table_args__ = (
        Index(
            "uq_tournament_event_catalog_division",
            "tournament_id", "event_id", "division",
            unique=True,
            postgresql_where=(event_id.isnot(None)),
        ),
    )


# ---------------------------------------------------------------------------
# TournamentShift — a tournament-scoped time window (e.g. "Shift 1, 8am-12pm")
# that can be attached to one or more TournamentEvents via the
# tournament_event_shifts bridge table.
# ---------------------------------------------------------------------------
class TournamentShift(Base):
    __tablename__ = "tournament_shifts"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False)
    label = Column(String(255), nullable=False)
    start = Column(DateTime(timezone=True), nullable=False)
    end = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    tournament = relationship("Tournament", back_populates="event_shifts")
    tournament_events = relationship(
        "TournamentEvent", secondary="tournament_event_shifts", back_populates="shifts"
    )
    membership_availabilities = relationship(
        "TournamentMembershipAvailability", back_populates="tournament_shift", cascade="all, delete-orphan"
    )

    # Read by TournamentShiftRead — how many events this shift is attached
    # to, for the delete-confirm warning. Callers that list many shifts
    # should eager-load tournament_events (see list_shifts) to avoid N+1.
    @property
    def event_count(self) -> int:
        return len(self.tournament_events)

    # Unlike event_count (advisory only — deletion still cascades through
    # events), a nonzero availability_count hard-blocks deletion — see
    # delete_shift. Availability write-through is membership-owned data,
    # not something a shift edit should silently detach.
    @property
    def availability_count(self) -> int:
        return len(self.membership_availabilities)


# ---------------------------------------------------------------------------
# TournamentTrack — a TD-managed volunteer track such as Test Writing or
# Day 1. Form fields reference the track's stable database ID in their config,
# so `name` can change without invalidating historical answers or statuses.
# ---------------------------------------------------------------------------
class TournamentTrack(Base):
    __tablename__ = "tournament_tracks"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    is_archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    tournament = relationship("Tournament", back_populates="tracks")
    member_statuses = relationship(
        "TournamentMembershipTrackStatus", back_populates="track", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("tournament_id", "name", name="uq_tournament_track_name"),
    )


# ---------------------------------------------------------------------------
# TournamentEventShift — bridge table: TournamentEvent <-> TournamentShift.
# ---------------------------------------------------------------------------
class TournamentEventShift(Base):
    __tablename__ = "tournament_event_shifts"

    tournament_event_id = Column(Integer, ForeignKey("tournament_events.id", ondelete="CASCADE"), primary_key=True)
    tournament_shift_id = Column(Integer, ForeignKey("tournament_shifts.id", ondelete="CASCADE"), primary_key=True)


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
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    tournament = relationship("Tournament", back_populates="sheet_configs")


# ---------------------------------------------------------------------------
# Form — a first-party form (replaces the Google Forms + sheet-sync
# pipeline). Owned by exactly one tournament OR one chapter (owner_type +
# CHECK constraint) — multi-tournament "group forms" are a later phase.
# ---------------------------------------------------------------------------
class Form(Base):
    __tablename__ = "forms"

    # index=True is redundant beside the primary key, but 7db31ae17e3c created
    # ix_forms_id and prod has it — declared here so the model matches the
    # migrations rather than silently drifting from them.
    id = Column(String(12), primary_key=True, default=generate_public_id, index=True)
    owner_type = Column(String(16), nullable=False)   # "tournament" | "chapter"
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=True)
    chapter_id = Column(Integer, ForeignKey("alumni_chapters.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(255), nullable=False)
    # Respondent-facing title, shown on the actual form — distinct from
    # `name` (the TD-facing dashboard/list label). Independently editable;
    # callers default it to `name` at creation time if not given, but
    # nothing here enforces them staying in sync afterward.
    title = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    status = Column(String(16), nullable=False, default="draft")  # "draft" | "published" | "archived"

    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    tournament = relationship("Tournament", back_populates="forms")
    chapter = relationship("AlumniChapter", back_populates="forms")
    creator = relationship("User", back_populates="created_forms")
    fields = relationship("FormField", back_populates="form", cascade="all, delete-orphan", order_by="FormField.order")
    responses = relationship("FormResponse", back_populates="form", cascade="all, delete-orphan")
    tournament_form = relationship("TournamentForm", back_populates="form", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "(owner_type = 'tournament' AND tournament_id IS NOT NULL AND chapter_id IS NULL) OR "
            "(owner_type = 'chapter' AND chapter_id IS NOT NULL AND tournament_id IS NULL)",
            name="ck_form_owner_exclusive",
        ),
    )

    # Read by the forms list page to preemptively disable Delete (which
    # 409s server-side if any responses exist) rather than let a TD hit a
    # dead-end click.
    @property
    def response_count(self) -> int:
        return len(self.responses)

    @property
    def prerequisites(self) -> dict | None:
        """TournamentForm configuration exposed on generic form responses."""
        return self.tournament_form.prerequisites if self.tournament_form else None


# ---------------------------------------------------------------------------
# TournamentForm — 1:1 companion row every tournament-scoped Form gets at
# creation time (see create_tournament_form in api/routes/forms.py). Never
# deleted while the Form exists; is_onboarding just toggles what the row
# means rather than the row itself coming and going.
#
# is_onboarding + order together define the onboarding step sequence for the
# tournament (order is only meaningful — and set — for is_onboarding=True
# rows). Standard, non-onboarding tournament forms leave order null; the
# eventual prerequisite/visibility mechanism for those is a later phase, not
# built yet.
#
# A form linked here with is_onboarding=True cannot be archived or deleted —
# see the guard in api/routes/forms.py's update_form/archive_form/
# delete_form — it must be removed from onboarding (is_onboarding flipped
# back to False) first.
#
# form_id is this row's own primary key, not a separate surrogate id — the
# relationship is strictly 1:1, so there's no "which TournamentForm" beyond
# "which Form." Deleting a Form (already blocked while responses exist, see
# Form's own delete route) cascades away its TournamentForm row for free;
# there's no independent "delete a TournamentForm" action.
# ---------------------------------------------------------------------------
class TournamentForm(Base):
    __tablename__ = "tournament_forms"

    form_id = Column(String(12), ForeignKey("forms.id", ondelete="CASCADE"), primary_key=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False)
    is_onboarding = Column(Boolean, nullable=False, default=False)
    order = Column(Integer, nullable=True)
    # Optional member-visibility requirements for standard tournament forms.
    # Shape and referenced-id validation live with the manager API; evaluation
    # lives in core/tournament/form_prerequisites.py so every future caller
    # (member form list, rendering, and submission) shares one rule.
    prerequisites = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    tournament = relationship("Tournament", back_populates="tournament_forms")
    form = relationship("Form", back_populates="tournament_form")


# ---------------------------------------------------------------------------
# FormField — a single question on a Form. question_type drives how config
# is shaped (see comments inline below). Removing a field with existing
# answers archives it instead of deleting (see app/core/form).
# ---------------------------------------------------------------------------
class FormField(Base):
    __tablename__ = "form_fields"

    id = Column(String(12), primary_key=True, default=generate_public_id, index=True)
    form_id = Column(String(12), ForeignKey("forms.id", ondelete="CASCADE"), nullable=False)
    order = Column(Integer, nullable=False)
    label = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    question_type = Column(String(32), nullable=False)
    # short_text | paragraph | single_select_radio | single_select_dropdown
    # | multi_select | ranked_choice | grid | shift_select | page_break

    # Dashboard lookup key — slugified from the TD-typed label at create
    # time (see app/core/form.slugify) and stable afterward, even if the
    # label is later edited. Unique per tournament, not just per form (see
    # app/core/form.check_field_key_available_in_tournament).
    field_key = Column(String(64), nullable=False)

    config = Column(JSON, nullable=True)
    # For plain choice questions: {"options": [{"id": "opt_1", "label": "...",
    #   "archived": false, "next_section_id": null, "allow_other": false}, ...]}
    # For "grid": {"rows": [{"id","label"}...], "columns": [{"id","label"}...],
    #   "column_selection": "single"|"multiple"}
    # For "page_break": unused, null

    is_archived = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    form = relationship("Form", back_populates="fields")
    answer = relationship("FormAnswer", back_populates="field")

    __table_args__ = (
        # Live fields only. An archived field doesn't reserve its key — see
        # field_key_taken_in_tournament — so an archived question and the one
        # replacing it can share a name. A plain UniqueConstraint here would
        # block that at the DB even though the application allows it.
        Index(
            "uq_form_field_key", "form_id", "field_key",
            unique=True,
            postgresql_where=text("is_archived = false"),
        ),
    )

    @validates("field_key")
    def validate_field_key(self, key, value):
        if not value or not value.replace("_", "").isalnum():
            raise ValueError("field_key must be snake_case alphanumeric")
        return value


# ---------------------------------------------------------------------------
# FormResponse — one row per (form, user). Resubmitting overwrites the
# existing response's answers in place; no submission history is kept.
# ---------------------------------------------------------------------------
class FormResponse(Base):
    __tablename__ = "form_responses"

    id = Column(String(12), primary_key=True, default=generate_public_id, index=True)
    form_id = Column(String(12), ForeignKey("forms.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    submitted_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    form = relationship("Form", back_populates="responses")
    user = relationship("User", back_populates="form_responses")
    answers = relationship("FormAnswer", back_populates="response", cascade="all, delete-orphan")
    pending_updates = relationship("FormResponsePendingUpdate", back_populates="response", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("form_id", "user_id", name="uq_form_response_per_user"),
    )


# ---------------------------------------------------------------------------
# FormAnswer — one row per (response, field). Generic value storage; shape
# of `value` depends on the field's question_type.
# ---------------------------------------------------------------------------
class FormAnswer(Base):
    __tablename__ = "form_answers"

    id = Column(String(12), primary_key=True, default=generate_public_id, index=True)
    response_id = Column(String(12), ForeignKey("form_responses.id", ondelete="CASCADE"), nullable=False)
    field_id = Column(String(12), ForeignKey("form_fields.id"), nullable=False)
    value = Column(JSON, nullable=False)
    # The semantics this answer was given under. `value`'s shape is a function
    # of (question_type, field_key) — a preset key stores entity ids where a
    # standard key stores text — so recording both here keeps a stored answer
    # readable after the field is edited, instead of reinterpreting history
    # through whatever the field looks like today. Nullable only for rows
    # predating this column; always written on new answers.
    question_type = Column(String(32), nullable=True)
    field_key = Column(String(64), nullable=True)

    response = relationship("FormResponse", back_populates="answers")
    field = relationship("FormField", back_populates="answer")

    __table_args__ = (
        UniqueConstraint("response_id", "field_id", name="uq_answer_per_field"),
    )


# ---------------------------------------------------------------------------
# FormResponsePendingUpdate — flags that a response's answer to a field needs
# another look, because the TD changed the question in a way that may have
# invalidated it. One row per (response, field_id).
#
# Keyed on field_id, never field_key: a key is a TD-editable display name, so
# keying history on it strands the flag the moment the question is renamed.
# The field a flag points at is therefore stable across every edit.
#
# `reasons` is a set, not a single value: one save can legitimately trigger
# several on the same field (an option added *and* the wording changed), so
# they union rather than override. A row is cleared when the respondent
# patches that field, and is deleted outright if the field is archived or
# invalidated — a flag on a question that can no longer be answered is
# unclearable by construction. See backend/form-edit-lifecycle.md.
# ---------------------------------------------------------------------------
class FormResponsePendingUpdate(Base):
    __tablename__ = "form_response_pending_updates"

    id = Column(Integer, primary_key=True, index=True)
    response_id = Column(String(12), ForeignKey("form_responses.id", ondelete="CASCADE"), nullable=False)
    field_id = Column(String(12), ForeignKey("form_fields.id", ondelete="CASCADE"), nullable=False)
    # See app/core/form/changes.py for the values and what raises each.
    reasons = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    response = relationship("FormResponse", back_populates="pending_updates")

    __table_args__ = (
        UniqueConstraint("response_id", "field_id", name="uq_pending_update_per_response_field"),
    )


# ---------------------------------------------------------------------------
# TournamentMembershipAvailability — write-through target for a form's
# "availability_{date}" field_key answers. Reuses TournamentShift directly,
# no separate catalog.
# ---------------------------------------------------------------------------
class TournamentMembershipAvailability(Base):
    __tablename__ = "tournament_membership_availability"

    id = Column(Integer, primary_key=True, index=True)
    membership_id = Column(Integer, ForeignKey("tournament_memberships.id", ondelete="CASCADE"), nullable=False)
    tournament_shift_id = Column(Integer, ForeignKey("tournament_shifts.id", ondelete="CASCADE"), nullable=False)

    membership = relationship("TournamentMembership", back_populates="availability_shifts")
    tournament_shift = relationship("TournamentShift", back_populates="membership_availabilities")

    __table_args__ = (
        UniqueConstraint("membership_id", "tournament_shift_id", name="uq_membership_availability"),
    )


# ---------------------------------------------------------------------------
# TournamentMembershipLunch — write-through target for a form's
# "lunch_{date}_{category}" field_key answers. Stores whatever was actually
# selected, keyed by category string — no dedicated menu/catalog table.
# ---------------------------------------------------------------------------
class TournamentMembershipLunch(Base):
    __tablename__ = "tournament_membership_lunch"

    id = Column(Integer, primary_key=True, index=True)
    membership_id = Column(Integer, ForeignKey("tournament_memberships.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    category = Column(String(64), nullable=False)
    value = Column(String(64), nullable=False)
    label = Column(String(255), nullable=False)

    membership = relationship("TournamentMembership", back_populates="lunch_selections")

    __table_args__ = (
        UniqueConstraint("membership_id", "date", "category", "value", name="uq_membership_lunch_selection"),
    )


# ---------------------------------------------------------------------------
# TournamentMembershipTrackStatus — write-through target for a form's
# "track_status_{suffix}" answers, and for "availability_{date}" answers on a
# field that opted in via config.track_status_enabled.
#
# One row per (membership, track): a track's status is a single current fact,
# not a history. Several questions across several forms feed the same row, so
# no field owns it and none can withdraw its contribution — write-through only
# ever upserts here, never deletes (see backend/form-edit-lifecycle.md).
#
# Writes are guarded by a transition rule rather than by submission ordering:
# a track never falls back to `interested` once it's moved past it, so a stale
# answer replayed out of order can never demote a track someone already
# confirmed. See can_set_track_status in app/core/form/write_through.py.
# ---------------------------------------------------------------------------
class TournamentMembershipTrackStatus(Base):
    __tablename__ = "tournament_membership_track_statuses"

    id = Column(Integer, primary_key=True, index=True)
    membership_id = Column(Integer, ForeignKey("tournament_memberships.id", ondelete="CASCADE"), nullable=False)
    # CASCADE, unlike a form field's reference to a track: a TD who hard-deletes
    # a track is removing it for good, and delete_track already refuses while
    # any form field still references it.
    track_id = Column(Integer, ForeignKey("tournament_tracks.id", ondelete="CASCADE"), nullable=False)

    # "interested" | "confirmed" | "declined"
    status = Column(String(32), nullable=False)

    # Where this status came from, recorded for debugging and TD-facing
    # provenance only — the transition rule, not this, is what keeps writes
    # ordered. Both SET NULL: invalidating the question that set a status must
    # not take the status with it. NULL also means "not set by a form", which
    # is what a future member self-edit path will write.
    source_response_id = Column(String(12), ForeignKey("form_responses.id", ondelete="SET NULL"), nullable=True)
    source_field_id = Column(String(12), ForeignKey("form_fields.id", ondelete="SET NULL"), nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    membership = relationship("TournamentMembership", back_populates="track_statuses")
    # lazy="joined": every read of a status row wants the track's name to
    # render it, so the hop is worth folding into the same query rather than
    # N+1-ing per row through the shared get_scoped_or_404 path.
    track = relationship("TournamentTrack", back_populates="member_statuses", lazy="joined")

    __table_args__ = (
        UniqueConstraint("membership_id", "track_id", name="uq_membership_track_status"),
    )


# ---------------------------------------------------------------------------
# TournamentMembershipEventPreference — write-through target for a form's
# "event_preference_{suffix}" answers. One row per (membership, key, event):
# an event may only appear in one option per field (see
# validate_event_preference_options), and a ranked_choice event_preference
# field is required to have allow_duplicates=false, so an event can never
# legitimately need two rows under the same key — rank is stored per row but
# isn't part of the uniqueness, unlike a naive (membership, key, event, rank)
# scheme would need.
# ---------------------------------------------------------------------------
class TournamentMembershipEventPreference(Base):
    __tablename__ = "tournament_membership_event_preferences"

    id = Column(Integer, primary_key=True, index=True)
    membership_id = Column(Integer, ForeignKey("tournament_memberships.id", ondelete="CASCADE"), nullable=False)
    tournament_event_id = Column(Integer, ForeignKey("tournament_events.id", ondelete="CASCADE"), nullable=False)

    key = Column(String(64), nullable=False)  # the event_preference_{suffix} suffix

    # ranked_choice: the submitted rank; single_select: 1; checkbox: null.
    rank = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    membership = relationship("TournamentMembership", back_populates="event_preferences")
    # lazy="joined": every read of a preference row wants the event's name/
    # division to render it, same reasoning as TrackStatus.track.
    tournament_event = relationship("TournamentEvent", lazy="joined")

    __table_args__ = (
        UniqueConstraint("membership_id", "key", "tournament_event_id", name="uq_membership_event_preference"),
    )
