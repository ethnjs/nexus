"""Tests for /chapters endpoints."""
import uuid
from datetime import datetime, timezone

from tests.conftest import login
from app.core.auth import hash_password
from app.models.models import AlumniChapter, ChapterMembership, University, User


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
        "is_active": True,
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
