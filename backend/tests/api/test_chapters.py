"""Tests for /chapters endpoints."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from tests.conftest import login
from app.core.auth import hash_password
from app.models.models import AlumniChapter, ChapterJoinCode, ChapterMembership, University, User


def _university(db, **kwargs):
    defaults = {
        "name": f"Test University {uuid.uuid4()}",
        "abbreviation": "TU",
        "location": "Test City",
    }
    defaults.update(kwargs)
    university = University(**defaults)
    db.add(university)
    db.commit()
    db.refresh(university)
    return university


def _chapter(db, university_id, **kwargs):
    defaults = {"name": f"Test Chapter {uuid.uuid4()}", "university_id": university_id}
    defaults.update(kwargs)
    chapter = AlumniChapter(**defaults)
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    return chapter


def _user(db, email, password="Password@1", role="user", **kwargs):
    defaults = {
        "first_name": "Test",
        "last_name": "User",
        "email": email,
        "hashed_password": hash_password(password),
        "role": role,
        "status": "active",
    }
    defaults.update(kwargs)
    user = User(**defaults)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# GET /chapters/ — admin only
# ---------------------------------------------------------------------------

def test_list_chapters_admin_only(client, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    login(client, "admin@test.com", "adminpass")

    res = client.get("/chapters/")
    assert res.status_code == 200
    assert any(item["id"] == chapter.id for item in res.json())


def test_list_chapters_non_admin_forbidden(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/chapters/").status_code == 403


def test_list_chapters_unauthenticated(client):
    assert client.get("/chapters/").status_code == 401


# ---------------------------------------------------------------------------
# POST /chapters/ — admin only
# ---------------------------------------------------------------------------

def test_create_chapter_creates_record(client, admin_user, db):
    university = _university(db)
    login(client, "admin@test.com", "adminpass")

    res = client.post(
        "/chapters/",
        json={
            "name": "New Chapter",
            "university_id": university.id,
            "created_at": datetime(2025, 1, 1, tzinfo=timezone.utc).isoformat(),
        },
    )
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "New Chapter"
    assert data["university"]["id"] == university.id

    created = db.query(AlumniChapter).filter_by(id=data["id"]).first()
    assert created is not None
    assert created.name == "New Chapter"


def test_create_chapter_duplicate_university_conflict(client, admin_user, db):
    university = _university(db)
    _chapter(db, university.id, name="Existing Chapter")
    login(client, "admin@test.com", "adminpass")

    res = client.post(
        "/chapters/",
        json={
            "name": "Another Chapter",
            "university_id": university.id,
            "created_at": datetime(2025, 1, 1, tzinfo=timezone.utc).isoformat(),
        },
    )
    assert res.status_code == 409


def test_create_chapter_non_admin_forbidden(client, td_user):
    login(client, "td@test.com", "tdpass")
    res = client.post(
        "/chapters/",
        json={
            "name": "Sneaky Chapter",
            "university_id": 1,
            "created_at": datetime(2025, 1, 1, tzinfo=timezone.utc).isoformat(),
        },
    )
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# PATCH /chapters/{chapter_id}/ — admin only
# ---------------------------------------------------------------------------

def test_get_chapter_non_admin_non_lead_forbidden(client, td_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    login(client, "td@test.com", "tdpass")

    assert client.get(f"/chapters/{chapter.id}/").status_code == 403


def test_get_chapter_lead_can_access(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "lead@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    login(client, "lead@example.com", "LeadPass123!")

    res = client.get(f"/chapters/{chapter.id}/")
    assert res.status_code == 200
    assert res.json()["id"] == chapter.id


def test_update_chapter_admin_can_change_name(client, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    login(client, "admin@test.com", "adminpass")

    res = client.patch(f"/chapters/{chapter.id}/", json={"name": "Renamed Chapter"})
    assert res.status_code == 200
    assert res.json()["name"] == "Renamed Chapter"


def test_update_chapter_non_admin_forbidden(client, td_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    login(client, "td@test.com", "tdpass")

    assert client.patch(f"/chapters/{chapter.id}/", json={"name": "Sneaky"}).status_code == 403


def test_update_chapter_not_found(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    assert client.patch("/chapters/9999/", json={"name": "Ghost"}).status_code == 404


# ---------------------------------------------------------------------------
# POST /chapters/{chapter_id}/leads/ — admin only
# ---------------------------------------------------------------------------

def test_assign_lead_creates_chapter_membership(client, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)

    member = _user(db, "member@example.com", password="MemberPass123!")

    login(client, "admin@test.com", "adminpass")
    res = client.post(f"/chapters/{chapter.id}/leads/", json={"user_id": member.id})
    assert res.status_code == 201

    membership = db.query(ChapterMembership).filter_by(chapter_id=chapter.id, user_id=member.id).first()
    assert membership is not None
    assert membership.role == "lead"


def test_assign_lead_non_admin_forbidden(client, td_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    member = _user(db, "member2@example.com", password="MemberPass123!")
    login(client, "td@test.com", "tdpass")

    assert client.post(f"/chapters/{chapter.id}/leads/", json={"user_id": member.id}).status_code == 403


# ---------------------------------------------------------------------------
# DELETE /chapters/{chapter_id}/leads/{user_id}/ — admin only
# ---------------------------------------------------------------------------

def test_remove_lead_marks_member(client, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)

    member = _user(db, "member3@example.com", password="MemberPass123!")

    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="lead"))
    db.commit()

    login(client, "admin@test.com", "adminpass")
    res = client.delete(f"/chapters/{chapter.id}/leads/{member.id}/")
    assert res.status_code == 204

    membership = db.query(ChapterMembership).filter_by(chapter_id=chapter.id, user_id=member.id).first()
    assert membership is not None
    assert membership.role == "member"


def test_remove_lead_non_admin_forbidden(client, td_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    member = _user(db, "member4@example.com", password="MemberPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="lead"))
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.delete(f"/chapters/{chapter.id}/leads/{member.id}/").status_code == 403


# ---------------------------------------------------------------------------
# Chapter member access boundaries
# ---------------------------------------------------------------------------

def test_get_members_non_lead_forbidden(client, td_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    login(client, "td@test.com", "tdpass")

    assert client.get(f"/chapters/{chapter.id}/members/").status_code == 403


def test_get_members_lead_can_access(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "leadmember@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    login(client, "leadmember@example.com", "LeadPass123!")

    res = client.get(f"/chapters/{chapter.id}/members/")
    assert res.status_code == 200


def test_update_member_role_non_lead_forbidden(client, td_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    member = _user(db, "member5@example.com", password="MemberPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.patch(f"/chapters/{chapter.id}/members/{member.id}/", params={"role": "lead"}).status_code == 403


def test_get_member_profile_non_lead_forbidden(client, td_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    member = _user(db, "member6@example.com", password="MemberPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.get(f"/chapters/{chapter.id}/members/{member.id}/profile/").status_code == 403


# ---------------------------------------------------------------------------
# Chapter join code endpoints
# ---------------------------------------------------------------------------

def test_get_join_codes_lead_can_access(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "joinlead@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    login(client, "joinlead@example.com", "LeadPass123!")

    res = client.get(f"/chapters/{chapter.id}/join-codes/")
    assert res.status_code == 200


def test_get_join_codes_non_lead_forbidden(client, td_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    login(client, "td@test.com", "tdpass")

    assert client.get(f"/chapters/{chapter.id}/join-codes/").status_code == 403


def test_create_join_code_creates_record(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "joincreator@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    login(client, "joincreator@example.com", "LeadPass123!")

    res = client.post(
        f"/chapters/{chapter.id}/join-codes/",
        json={"label": "Spring 2026", "expires_in_hours": 24},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["label"] == "Spring 2026"
    assert data["is_active"] is True
    assert data["code"]

    created = db.query(ChapterJoinCode).filter_by(id=data["id"]).first()
    assert created is not None
    assert created.label == "Spring 2026"


def test_deactivate_join_code_marks_inactive(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "joinlead2@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    join_code = ChapterJoinCode(
        chapter_id=chapter.id,
        created_by=lead.id,
        code="ABC12345",
        label="Test Code",
        expires_at=None,
        is_active=True,
    )
    db.add(join_code)
    db.commit()
    db.refresh(join_code)
    login(client, "joinlead2@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/join-codes/{join_code.id}/", json={"is_active": False})
    assert res.status_code == 200
    assert res.json()["is_active"] is False

    refreshed = db.query(ChapterJoinCode).filter_by(id=join_code.id).first()
    assert refreshed is not None
    assert refreshed.is_active is False


def test_deactivate_join_code_twice_rejected(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "joinlead3@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    join_code = ChapterJoinCode(
        chapter_id=chapter.id,
        created_by=lead.id,
        code="XYZ98765",
        label="Already Deactivated",
        expires_at=None,
        is_active=False,
    )
    db.add(join_code)
    db.commit()
    db.refresh(join_code)
    login(client, "joinlead3@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/join-codes/{join_code.id}/", json={"is_active": False})
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Public chapter join flow error paths
# ---------------------------------------------------------------------------

def _join_code(db, chapter_id, created_by, **kwargs):
    defaults = {
        "code": "JOIN1234",
        "label": "Join code",
        "expires_at": None,
        "is_active": True,
    }
    defaults.update(kwargs)
    join_code = ChapterJoinCode(
        chapter_id=chapter_id,
        created_by=created_by,
        **defaults,
    )
    db.add(join_code)
    db.commit()
    db.refresh(join_code)
    return join_code


@pytest.mark.parametrize("params", [{}, {"code": "SHORT"}, {"code": "TOO-LONG9"}])
def test_preview_chapter_rejects_missing_or_malformed_code(client, params):
    res = client.get("/join-chapter/", params=params)

    assert res.status_code == 422


def test_preview_chapter_rejects_unknown_code(client):
    res = client.get("/join-chapter/", params={"code": "UNKNOWN1"})

    assert res.status_code == 404
    assert res.json()["detail"] == "Invalid join code"


def test_preview_chapter_rejects_deactivated_code(client, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    _join_code(db, chapter.id, admin_user.id, code="INACTIVE", is_active=False)

    res = client.get("/join-chapter/", params={"code": "INACTIVE"})

    assert res.status_code == 400
    assert res.json()["detail"] == "This join code has been deactivated"


def test_preview_chapter_rejects_expired_code(client, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    expired_at = datetime.now(timezone.utc) - timedelta(hours=1)
    _join_code(db, chapter.id, admin_user.id, code="EXPIRED1", expires_at=expired_at)
    res = client.get("/join-chapter/", params={"code": "EXPIRED1"})

    assert res.status_code == 400
    assert res.json()["detail"] == "This join code has expired"


def test_join_chapter_requires_authentication(client):
    res = client.post("/join-chapter/", json={"code": "JOIN1234"})

    assert res.status_code == 401


@pytest.mark.parametrize("payload", [{}, {"code": "SHORT"}, {"code": "TOO-LONG9"}])
def test_join_chapter_rejects_malformed_code(client, td_user, payload):
    login(client, "td@test.com", "tdpass")

    res = client.post("/join-chapter/", json=payload)

    assert res.status_code == 422


def test_join_chapter_rejects_existing_member(client, td_user, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=td_user.id, role="member"))
    db.commit()
    login(client, "td@test.com", "tdpass")

    res = client.post("/join-chapter/", json={"code": "JOIN1234"})

    assert res.status_code == 400
    assert res.json()["detail"] == "User is already a member of a chapter"


def test_join_chapter_rejects_unknown_code(client, td_user):
    login(client, "td@test.com", "tdpass")

    res = client.post("/join-chapter/", json={"code": "UNKNOWN1"})

    assert res.status_code == 404
    assert res.json()["detail"] == "Invalid join code"


def test_join_chapter_rejects_deactivated_code(client, td_user, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    _join_code(db, chapter.id, admin_user.id, code="INACTIVE", is_active=False)
    login(client, "td@test.com", "tdpass")

    res = client.post("/join-chapter/", json={"code": "INACTIVE"})

    assert res.status_code == 400
    assert res.json()["detail"] == "This join code has been deactivated"


def test_join_chapter_rejects_expired_code(client, td_user, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    expired_at = datetime.now(timezone.utc) - timedelta(hours=1)
    _join_code(db, chapter.id, admin_user.id, code="EXPIRED1", expires_at=expired_at)
    login(client, "td@test.com", "tdpass")

    res = client.post("/join-chapter/", json={"code": "EXPIRED1"})

    assert res.status_code == 400
    assert res.json()["detail"] == "This join code has expired"


def test_join_chapter_handles_membership_integrity_conflict(client, td_user, admin_user, db, monkeypatch):
    university = _university(db)
    chapter = _chapter(db, university.id)
    _join_code(db, chapter.id, admin_user.id)
    login(client, "td@test.com", "tdpass")

    def raise_integrity_error():
        raise IntegrityError("INSERT INTO chapter_memberships", {}, Exception("duplicate membership"))

    monkeypatch.setattr(db, "commit", raise_integrity_error)
    res = client.post("/join-chapter/", json={"code": "JOIN1234"})

    assert res.status_code == 400
    assert res.json()["detail"] == "User is already a member of a chapter"
