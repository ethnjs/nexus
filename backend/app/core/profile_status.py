from sqlalchemy.orm import Session
from typing import Optional

from app.models.models import User, UserCompetitionExperience, UserVolunteerExperience

def _has_competition_rows(user: User, db: Optional[Session]) -> bool:
    if db is not None:
        return db.query(
            db.query(UserCompetitionExperience).filter_by(user_id=user.id).exists()
        ).scalar()
    return bool(user.competition_experience)


def _has_volunteer_rows(user: User, db: Optional[Session]) -> bool:
    """
    Manual entries ONLY — intentionally does not include NEXUS-synthesized rows
    (from TournamentMembership, once that integration exists).
    has_volunteer_experience reflects whether the user intends to log manual
    entries, independent of any auto-populated tournament history. Do not change
    this to query a merged/synthesized experience list.
    """
    if db is not None:
        return db.query(
            db.query(UserVolunteerExperience).filter_by(user_id=user.id).exists()
        ).scalar()
    return bool(user.volunteer_experience)


def compute_missing_profile_fields(user: User, *, db: Optional[Session] = None) -> list[str]:
    always_required = ["phone", "date_of_birth", "shirt_size", "dietary_restriction"]
    missing = [f for f in always_required if not getattr(user, f)]

    if not user.student_status:
        missing.append("student_status")
    elif user.student_status == "Non-Student":
        if not user.employer:
            missing.append("employer")
    else:
        for f in ["university", "major", "year_level", "graduation_year"]:
            if not getattr(user, f):
                missing.append(f)

    if user.has_competition_experience is None:
        missing.append("has_competition_experience")
    elif user.has_competition_experience is True and not _has_competition_rows(user, db):
        missing.append("has_competition_experience")

    if user.has_volunteer_experience is None:
        missing.append("has_volunteer_experience")
    elif user.has_volunteer_experience is True and not _has_volunteer_rows(user, db):
        missing.append("has_volunteer_experience")

    return missing


def is_profile_complete(user: User, *, db: Optional[Session] = None) -> bool:
    return not compute_missing_profile_fields(user, db=db)