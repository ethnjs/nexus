"""Tests for the unified POST /join/ endpoint (app/api/routes/join.py) —
dispatches a single global join code to either tournament or chapter
redemption depending on which target it points to."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from tests.conftest import grant_role, login
from tests.api.chapter._helpers import make_chapter, make_university, make_user
from app.models.models import ChapterMembership, JoinCode, TournamentMembership


def make_tournament_join_code(db, tournament_id, created_by, **kwargs):
    defaults = {"code": "JOIN1234", "label": "Join code", "expires_at": None, "is_active": True}
    defaults.update(kwargs)
    join_code = JoinCode(tournament_id=tournament_id, created_by=created_by, **defaults)
    db.add(join_code)
    db.commit()
    db.refresh(join_code)
    return join_code


def make_chapter_join_code(db, chapter_id, created_by, **kwargs):
    defaults = {"code": "JOIN1234", "label": "Join code", "expires_at": None, "is_active": True}
    defaults.update(kwargs)
    join_code = JoinCode(chapter_id=chapter_id, created_by=created_by, **defaults)
    db.add(join_code)
    db.commit()
    db.refresh(join_code)
    return join_code


# ---------------------------------------------------------------------------
# Shared behavior — auth, missing code, unknown code
# ---------------------------------------------------------------------------

def test_join_requires_authentication(client):
    assert client.post("/join/?code=JOIN1234").status_code == 401


def test_join_rejects_missing_code(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.post("/join/").status_code == 422


@pytest.mark.parametrize("code", ["SHORT", "TOO-LONG9", "UNKNOWN1"])
def test_join_rejects_code_that_does_not_exist(client, td_user, code):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/join/?code={code}")
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or expired join code"


# ---------------------------------------------------------------------------
# Tournament codes
# ---------------------------------------------------------------------------

def test_join_tournament_success_creates_interested_membership(client, td_user, td_tournament, other_user, db):
    join_code = make_tournament_join_code(db, td_tournament.id, td_user.id, code="USECOUNT")
    login(client, "other@test.com", "otherpass")

    response = client.post("/join/?code=USECOUNT")
    assert response.status_code == 201
    data = response.json()
    assert data["type"] == "tournament"
    assert data["target_id"] == td_tournament.id

    membership = db.query(TournamentMembership).filter(
        TournamentMembership.user_id == other_user.id,
        TournamentMembership.tournament_id == td_tournament.id,
    ).first()
    assert membership is not None
    assert membership.status == "interested"
    assert membership.roles == []
    assert data["membership_id"] == membership.id

    db.refresh(join_code)
    assert join_code.use_count == 1


def test_join_tournament_rejects_deactivated_code(client, td_user, td_tournament, other_user, db):
    make_tournament_join_code(db, td_tournament.id, td_user.id, code="INACTIVE", is_active=False)
    login(client, "other@test.com", "otherpass")

    response = client.post("/join/?code=INACTIVE")
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or expired join code"


def test_join_tournament_rejects_expired_code(client, td_user, td_tournament, other_user, db):
    expired_at = datetime.now(timezone.utc) - timedelta(hours=1)
    make_tournament_join_code(db, td_tournament.id, td_user.id, code="EXPIRED1", expires_at=expired_at)
    login(client, "other@test.com", "otherpass")

    response = client.post("/join/?code=EXPIRED1")
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or expired join code"


def test_join_tournament_rejects_existing_member(client, td_user, td_tournament, other_user, db):
    grant_role(db, td_tournament, other_user, "event_supervisor")
    make_tournament_join_code(db, td_tournament.id, td_user.id, code="AGAIN123")
    login(client, "other@test.com", "otherpass")

    response = client.post("/join/?code=AGAIN123")
    assert response.status_code == 409
    assert response.json()["detail"] == "Already a member of this tournament"


def test_join_tournament_handles_membership_integrity_conflict(client, td_user, td_tournament, other_user, db, monkeypatch):
    make_tournament_join_code(db, td_tournament.id, td_user.id, code="RACE1234")
    login(client, "other@test.com", "otherpass")

    def raise_integrity_error():
        raise IntegrityError("INSERT INTO tournament_memberships", {}, Exception("duplicate membership"))

    monkeypatch.setattr(db, "commit", raise_integrity_error)
    response = client.post("/join/?code=RACE1234")
    assert response.status_code == 409
    assert response.json()["detail"] == "Already a member of this tournament"


# ---------------------------------------------------------------------------
# Chapter codes
# ---------------------------------------------------------------------------

def test_join_chapter_success_increments_use_count(client, admin_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    join_code = make_chapter_join_code(db, chapter.id, admin_user.id, code="USECOUNT")
    assert join_code.use_count == 0

    joiner = make_user(db, "usecountjoiner@example.com", password="JoinPass123!")
    login(client, "usecountjoiner@example.com", "JoinPass123!")

    response = client.post("/join/?code=USECOUNT")
    assert response.status_code == 201
    data = response.json()
    assert data["type"] == "chapter"
    assert data["target_id"] == chapter.id

    membership = db.query(ChapterMembership).filter_by(user_id=joiner.id).first()
    assert membership is not None
    assert membership.role == "member"
    assert data["membership_id"] == membership.id

    db.refresh(join_code)
    assert join_code.use_count == 1


def test_join_chapter_rejects_existing_member(client, td_user, admin_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=td_user.id, role="member"))
    db.commit()
    make_chapter_join_code(db, chapter.id, admin_user.id, code="JOIN1234")
    login(client, "td@test.com", "tdpass")

    response = client.post("/join/?code=JOIN1234")
    assert response.status_code == 400
    assert response.json()["detail"] == "User is already a member of a chapter"


def test_join_chapter_rejects_deactivated_code(client, td_user, admin_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    make_chapter_join_code(db, chapter.id, admin_user.id, code="INACTIVE", is_active=False)
    login(client, "td@test.com", "tdpass")

    response = client.post("/join/?code=INACTIVE")
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or expired join code"


def test_join_chapter_rejects_expired_code(client, td_user, admin_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    expired_at = datetime.now(timezone.utc) - timedelta(hours=1)
    make_chapter_join_code(db, chapter.id, admin_user.id, code="EXPIRED1", expires_at=expired_at)
    login(client, "td@test.com", "tdpass")

    response = client.post("/join/?code=EXPIRED1")
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or expired join code"


def test_join_chapter_handles_membership_integrity_conflict(client, td_user, admin_user, db, monkeypatch):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    make_chapter_join_code(db, chapter.id, admin_user.id)
    login(client, "td@test.com", "tdpass")

    def raise_integrity_error():
        raise IntegrityError("INSERT INTO chapter_memberships", {}, Exception("duplicate membership"))

    monkeypatch.setattr(db, "commit", raise_integrity_error)
    response = client.post("/join/?code=JOIN1234")
    assert response.status_code == 400
    assert response.json()["detail"] == "User is already a member of a chapter"
