"""Tests for app/core/profile_status.py.

The interesting part is the has_*_experience pair: the flag alone isn't enough,
a user who ticked "yes I have experience" but logged no rows is still
incomplete. Each helper has two paths — an EXISTS query when a Session is
passed, the loaded relationship when it isn't — and both are exercised here,
since a caller that forgets to pass db must not get a different answer.
"""
from datetime import date

import pytest

from app.core.profile_status import (
    compute_missing_profile_fields,
    is_onboarding_complete,
    is_profile_complete,
)
from app.models.models import User, UserCompetitionExperience, UserVolunteerExperience


COMPLETE_NON_STUDENT = dict(
    first_name="Ada", last_name="Lovelace", phone="9495551234",
    date_of_birth=date(1990, 1, 1), shirt_size="M", dietary_restriction="None",
    student_status="Non-Student", employer="Analytical Engines Inc.",
    has_competition_experience=False, has_volunteer_experience=False,
)


@pytest.fixture
def user_factory(db):
    def _make(**overrides):
        fields = {**COMPLETE_NON_STUDENT, **overrides}
        user = User(email=f"profile{id(overrides)}@test.com", role="user", status="active", **fields)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    return _make


# ---------------------------------------------------------------------------
# Baseline
# ---------------------------------------------------------------------------

def test_complete_non_student_has_nothing_missing(user_factory, db):
    user = user_factory()
    assert compute_missing_profile_fields(user, db=db) == []
    assert is_profile_complete(user, db=db) is True


@pytest.mark.parametrize(
    "field", ["first_name", "last_name", "phone", "date_of_birth", "shirt_size", "dietary_restriction"]
)
def test_always_required_field_reported_when_blank(user_factory, db, field):
    user = user_factory(**{field: None})
    assert field in compute_missing_profile_fields(user, db=db)
    assert is_profile_complete(user, db=db) is False


# ---------------------------------------------------------------------------
# student_status branching
# ---------------------------------------------------------------------------

def test_missing_student_status_reported(user_factory, db):
    user = user_factory(student_status=None)
    assert "student_status" in compute_missing_profile_fields(user, db=db)


def test_non_student_requires_employer(user_factory, db):
    user = user_factory(student_status="Non-Student", employer=None)
    assert "employer" in compute_missing_profile_fields(user, db=db)


def test_non_student_does_not_require_school_fields(user_factory, db):
    """A non-student is never asked for major/year_level/graduation_year."""
    user = user_factory(student_status="Non-Student", major=None, year_level=None, graduation_year=None)
    missing = compute_missing_profile_fields(user, db=db)
    assert not {"university", "major", "year_level", "graduation_year"} & set(missing)


def test_student_requires_school_fields(user_factory, db):
    user = user_factory(student_status="Undergraduate", employer=None)
    missing = compute_missing_profile_fields(user, db=db)
    assert {"university", "major", "year_level", "graduation_year"} <= set(missing)


def test_student_does_not_require_employer(user_factory, db):
    user = user_factory(student_status="Graduate", employer=None)
    assert "employer" not in compute_missing_profile_fields(user, db=db)


# ---------------------------------------------------------------------------
# has_competition_experience / has_volunteer_experience
# ---------------------------------------------------------------------------

def test_null_experience_flag_is_missing(user_factory, db):
    """Null means unanswered — distinct from an explicit False."""
    user = user_factory(has_competition_experience=None, has_volunteer_experience=None)
    missing = compute_missing_profile_fields(user, db=db)
    assert "has_competition_experience" in missing
    assert "has_volunteer_experience" in missing


def test_false_experience_flag_is_complete(user_factory, db):
    """Answering "no" is a complete answer and needs no backing rows."""
    user = user_factory(has_competition_experience=False, has_volunteer_experience=False)
    assert compute_missing_profile_fields(user, db=db) == []


def test_competition_flag_true_without_rows_is_missing(user_factory, db):
    user = user_factory(has_competition_experience=True)
    assert "has_competition_experience" in compute_missing_profile_fields(user, db=db)


def test_competition_flag_true_with_rows_is_complete(user_factory, db, event):
    user = user_factory(has_competition_experience=True)
    db.add(UserCompetitionExperience(user_id=user.id, event_id=event.id, school="Caltech"))
    db.commit()
    assert compute_missing_profile_fields(user, db=db) == []


def test_volunteer_flag_true_without_rows_is_missing(user_factory, db):
    user = user_factory(has_volunteer_experience=True)
    assert "has_volunteer_experience" in compute_missing_profile_fields(user, db=db)


def test_volunteer_flag_true_with_rows_is_complete(user_factory, db):
    user = user_factory(has_volunteer_experience=True)
    db.add(UserVolunteerExperience(
        user_id=user.id, tournament_name="SoCal States", year=2026, role="Event Supervisor",
    ))
    db.commit()
    assert compute_missing_profile_fields(user, db=db) == []


# ---------------------------------------------------------------------------
# db=None falls back to the loaded relationship — must agree with the query path
# ---------------------------------------------------------------------------

def test_without_db_uses_relationship_competition(user_factory, db, event):
    user = user_factory(has_competition_experience=True)
    assert "has_competition_experience" in compute_missing_profile_fields(user)

    db.add(UserCompetitionExperience(user_id=user.id, event_id=event.id, school="Caltech"))
    db.commit()
    db.refresh(user)
    assert compute_missing_profile_fields(user) == []


def test_without_db_uses_relationship_volunteer(user_factory, db):
    user = user_factory(has_volunteer_experience=True)
    assert "has_volunteer_experience" in compute_missing_profile_fields(user)

    db.add(UserVolunteerExperience(
        user_id=user.id, tournament_name="SoCal States", year=2026, role="Event Supervisor",
    ))
    db.commit()
    db.refresh(user)
    assert compute_missing_profile_fields(user) == []


# ---------------------------------------------------------------------------
# Onboarding — delegates to compute_missing_profile_fields; pronouns is the
# only field that can be blank and still count as onboarded.
# ---------------------------------------------------------------------------

def test_onboarding_complete_ignores_pronouns(user_factory, db):
    user = user_factory(pronouns=None)
    assert is_onboarding_complete(user, db=db) is True


@pytest.mark.parametrize(
    "field", ["first_name", "last_name", "phone", "date_of_birth", "shirt_size", "dietary_restriction"]
)
def test_onboarding_reports_each_required_field(user_factory, db, field):
    user = user_factory(**{field: None})
    assert is_onboarding_complete(user, db=db) is False
