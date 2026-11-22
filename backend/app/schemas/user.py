from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, EmailStr, Field, field_validator, model_validator

from app.core.phone import normalize_phone as _normalize_phone
from app.schemas.university import UniversityResponse
from app.schemas.user_experience import CompetitionExperienceResponse, VolunteerExperienceResponse

ROLE = Literal["admin", "user"]
USER_STATUS = Literal["active", "invited", "deactivated", "locked"]
STUDENT_STATUS = Literal["Undergraduate", "Graduate", "Non-Student"]


class UserUpdate(BaseModel):
    """Partial update — all fields optional."""

    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    date_of_birth: date | None = None
    pronouns: str | None = None

    student_status: STUDENT_STATUS | None = None
    university_id: int | None = None
    major: str | None = None
    year_level: int | None = None
    graduation_year: int | None = None

    employer: str | None = None

    has_competition_experience: bool | None = None
    has_volunteer_experience: bool | None = None

    shirt_size: str | None = None
    dietary_restriction: str | None = None

    @field_validator("first_name", "last_name", "phone")
    @classmethod
    def reject_null(cls, v):
        if v is None:
            raise ValueError("Cannot be null")
        return v

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, v: str | None) -> str | None:
        return _normalize_phone(v)


class AdminUserUpdate(BaseModel):
    role: Literal["user", "admin"] | None = None
    status: USER_STATUS | None = None
    email: EmailStr | None = None


class UserSlimResponse(BaseModel):
    id: int
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr
    phone: str | None = None
    pronouns: str | None = None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AdminUserSlimResponse(UserSlimResponse):
    email_verified: bool
    role: ROLE
    status: USER_STATUS


class AdminUserListResponse(AdminUserSlimResponse):
    """The admin users table's row: account fields plus what its affiliation,
    year level and tournament filter read."""

    student_status: STUDENT_STATUS | None = None
    university: UniversityResponse | None = None
    year_level: int | None = None
    employer: str | None = None
    tournament_ids: list[int] = Field(default=[], validation_alias="memberships")

    @field_validator("tournament_ids", mode="before")
    @classmethod
    def _tournament_ids(cls, memberships: list[Any]) -> list[int]:
        return [m.tournament_id for m in memberships]


class UserMeSlimResponse(AdminUserSlimResponse):
    is_profile_complete: bool = False
    is_onboarding_complete: bool = False


class TournamentMembershipAssignment(BaseModel):
    role: str
    event: str | None = None


class UserTournamentMembershipResponse(BaseModel):
    """One NEXUS tournament the user joined, with the roles and events they
    held there. Shown beside self-reported volunteer experience."""

    tournament_id: int
    tournament_name: str
    short_name: str | None = None
    year: int | None = None
    assignments: list[TournamentMembershipAssignment] = []

    @model_validator(mode="before")
    @classmethod
    def _from_membership(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return data
        tournament = data.tournament
        # One role yields a row per track it's held on, so pairs repeat.
        pairs: dict[tuple[str, str | None], None] = {}
        for assignment in sorted(data.track_assignments, key=lambda a: a.role.rank):
            event = assignment.tournament_event
            pairs[(assignment.role.label, event.display_name if event else None)] = None
        # A role held on its own and again with an event reads as one row.
        with_event = {role for role, event in pairs if event is not None}
        return {
            "tournament_id": tournament.id,
            "tournament_name": tournament.name,
            "short_name": tournament.short_name,
            "year": tournament.season_year,
            "assignments": [
                {"role": role, "event": event}
                for role, event in pairs
                if event is not None or role not in with_event
            ],
        }


class UserFullResponse(UserSlimResponse):
    student_status: STUDENT_STATUS | None = None
    university: UniversityResponse | None = None
    major: str | None = None
    year_level: int | None = None
    graduation_year: int | None = None

    employer: str | None = None

    has_competition_experience: bool | None = None
    has_volunteer_experience: bool | None = None

    competition_experience: list[CompetitionExperienceResponse] = []
    volunteer_experience: list[VolunteerExperienceResponse] = []
    tournament_memberships: list[UserTournamentMembershipResponse] = Field(
        default=[], validation_alias=AliasChoices("memberships", "tournament_memberships")
    )

    shirt_size: str | None = None
    dietary_restriction: str | None = None


class OwnedTournamentRef(BaseModel):
    id: int
    name: str
    short_name: str | None = None
    is_archived: bool

    model_config = {"from_attributes": True}


class AdminUserFullResponse(UserFullResponse, AdminUserSlimResponse):
    # Read off User.tournaments. The admin delete confirmation lists these —
    # they survive the delete but are left without an owner.
    owned_tournaments: list[OwnedTournamentRef] = Field(default=[], validation_alias="tournaments")


class UserMeFullResponse(UserFullResponse, UserMeSlimResponse):
    date_of_birth: date | None = None
    missing_profile_fields: list[str] = []
