"""Tests for /chapters and /admin/chapters endpoints."""
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


# ---------------------------------------------------------------------------
# GET /admin/chapters/ — admin only
# ---------------------------------------------------------------------------

def test_list_chapters_admin_only(client, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    login(client, "admin@test.com", "adminpass")

    res = client.get("/admin/chapters/")
    assert res.status_code == 200
    assert any(item["id"] == chapter.id for item in res.json())


def test_list_chapters_non_admin_forbidden(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/admin/chapters/").status_code == 403


def test_list_chapters_unauthenticated(client):
    assert client.get("/admin/chapters/").status_code == 401


# ---------------------------------------------------------------------------
# POST /admin/chapters/ — admin only
# ---------------------------------------------------------------------------

def test_create_chapter_creates_record(client, admin_user, db):
    university = _university(db)
    login(client, "admin@test.com", "adminpass")

    res = client.post(
        "/admin/chapters/",
        json={
            "name": "New Chapter",
            "university_id": university.id,
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
        "/admin/chapters/",
        json={
            "name": "Another Chapter",
            "university_id": university.id,
        },
    )
    assert res.status_code == 409


def test_create_chapter_non_admin_forbidden(client, td_user):
    login(client, "td@test.com", "tdpass")
    res = client.post(
        "/admin/chapters/",
        json={
            "name": "Sneaky Chapter",
            "university_id": 1,
        },
    )
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# GET /chapters/{chapter_id}/ — public
# ---------------------------------------------------------------------------

def test_get_chapter_is_public(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)

    res = client.get(f"/chapters/{chapter.id}/")
    assert res.status_code == 200
    assert res.json()["id"] == chapter.id
    assert res.json()["university"]["id"] == university.id


def test_get_chapter_not_found(client):
    assert client.get("/chapters/9999/").status_code == 404


# ---------------------------------------------------------------------------
# PATCH /chapters/{chapter_id}/ — chapter lead or admin
# ---------------------------------------------------------------------------

def test_update_chapter_admin_can_change_name(client, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    login(client, "admin@test.com", "adminpass")

    res = client.patch(f"/chapters/{chapter.id}/", json={"name": "Renamed Chapter"})
    assert res.status_code == 200
    assert res.json()["name"] == "Renamed Chapter"


def test_update_chapter_lead_can_change_name(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "updatelead@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    login(client, "updatelead@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/", json={"name": "Lead Renamed"})
    assert res.status_code == 200
    assert res.json()["name"] == "Lead Renamed"


def test_update_chapter_non_lead_non_admin_forbidden(client, td_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    login(client, "td@test.com", "tdpass")

    assert client.patch(f"/chapters/{chapter.id}/", json={"name": "Sneaky"}).status_code == 403


def test_update_chapter_not_found(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    assert client.patch("/chapters/9999/", json={"name": "Ghost"}).status_code == 404


# ---------------------------------------------------------------------------
# POST /admin/chapters/{chapter_id}/leads/ — admin only
# ---------------------------------------------------------------------------

def test_assign_lead_creates_chapter_membership(client, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)

    member = _user(db, "member@example.com", password="MemberPass123!")

    login(client, "admin@test.com", "adminpass")
    res = client.post(f"/admin/chapters/{chapter.id}/leads/", json={"user_id": member.id})
    assert res.status_code == 201

    membership = db.query(ChapterMembership).filter_by(chapter_id=chapter.id, user_id=member.id).first()
    assert membership is not None
    assert membership.role == "lead"


def test_assign_lead_non_admin_forbidden(client, td_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    member = _user(db, "member2@example.com", password="MemberPass123!")
    login(client, "td@test.com", "tdpass")

    assert client.post(f"/admin/chapters/{chapter.id}/leads/", json={"user_id": member.id}).status_code == 403


# ---------------------------------------------------------------------------
# DELETE /admin/chapters/{chapter_id}/leads/{user_id}/ — admin only
# ---------------------------------------------------------------------------

def test_remove_lead_marks_member(client, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)

    member = _user(db, "member3@example.com", password="MemberPass123!")

    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="lead"))
    db.commit()

    login(client, "admin@test.com", "adminpass")
    res = client.delete(f"/admin/chapters/{chapter.id}/leads/{member.id}/")
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

    assert client.delete(f"/admin/chapters/{chapter.id}/leads/{member.id}/").status_code == 403


# ---------------------------------------------------------------------------
# GET /chapters/{chapter_id}/members/ — chapter officer/lead or admin
# ---------------------------------------------------------------------------

def test_get_members_non_member_forbidden(client, td_user, db):
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


def test_get_members_officer_can_access(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    officer = _user(db, "officermember@example.com", password="OfficerPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=officer.id, role="officer"))
    db.commit()
    login(client, "officermember@example.com", "OfficerPass123!")

    res = client.get(f"/chapters/{chapter.id}/members/")
    assert res.status_code == 200


def test_get_members_plain_member_forbidden(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    member = _user(db, "plainmember@example.com", password="MemberPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "plainmember@example.com", "MemberPass123!")

    assert client.get(f"/chapters/{chapter.id}/members/").status_code == 403


def test_get_members_admin_can_access(client, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    login(client, "admin@test.com", "adminpass")

    assert client.get(f"/chapters/{chapter.id}/members/").status_code == 200


def test_get_members_response_shape_is_flattened(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "shapelead@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    lead_membership = db.query(ChapterMembership).filter_by(chapter_id=chapter.id, user_id=lead.id).first()
    login(client, "shapelead@example.com", "LeadPass123!")

    res = client.get(f"/chapters/{chapter.id}/members/")
    assert res.status_code == 200
    [entry] = res.json()
    assert entry["id"] == lead.id
    assert entry["membership_id"] == lead_membership.id
    assert entry["role"] == "lead"
    assert entry["email"] == "shapelead@example.com"
    assert "user" not in entry


# ---------------------------------------------------------------------------
# DELETE /chapters/{chapter_id}/members/{user_id}/ — chapter lead or admin
# ---------------------------------------------------------------------------

def test_delete_member_lead_can_remove(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "deletelead@example.com", password="LeadPass123!")
    member = _user(db, "deleteme@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "deletelead@example.com", "LeadPass123!")

    res = client.delete(f"/chapters/{chapter.id}/members/{member.id}/")
    assert res.status_code == 204
    assert db.query(ChapterMembership).filter_by(chapter_id=chapter.id, user_id=member.id).first() is None


def test_delete_member_officer_forbidden(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    officer = _user(db, "deleteofficer@example.com", password="OfficerPass123!")
    member = _user(db, "deleteme2@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=officer.id, role="officer"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "deleteofficer@example.com", "OfficerPass123!")

    assert client.delete(f"/chapters/{chapter.id}/members/{member.id}/").status_code == 403


def test_delete_member_not_found(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "deletelead2@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    login(client, "deletelead2@example.com", "LeadPass123!")

    assert client.delete(f"/chapters/{chapter.id}/members/9999/").status_code == 404


# ---------------------------------------------------------------------------
# PATCH /chapters/{chapter_id}/members/{user_id}/ — chapter lead only
# ---------------------------------------------------------------------------

def test_update_member_role_lead_can_promote(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "roleupdatelead@example.com", password="LeadPass123!")
    member = _user(db, "roleupdatemember@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "roleupdatelead@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/members/{member.id}/", json={"role": "officer"})
    assert res.status_code == 200
    assert res.json()["role"] == "officer"

    refreshed = db.query(ChapterMembership).filter_by(chapter_id=chapter.id, user_id=member.id).first()
    assert refreshed.role == "officer"


def test_update_member_role_lead_can_assign_another_lead(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "roleupdatelead2@example.com", password="LeadPass123!")
    member = _user(db, "roleupdatemember2@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "roleupdatelead2@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/members/{member.id}/", json={"role": "lead"})
    assert res.status_code == 200
    assert res.json()["role"] == "lead"


def test_update_member_role_rejects_invalid_role(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "roleupdatelead3@example.com", password="LeadPass123!")
    member = _user(db, "roleupdatemember3@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "roleupdatelead3@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/members/{member.id}/", json={"role": "superadmin"})
    assert res.status_code == 422


def test_update_member_role_already_has_role_conflicts(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "roleupdatelead4@example.com", password="LeadPass123!")
    member = _user(db, "roleupdatemember4@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "roleupdatelead4@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/members/{member.id}/", json={"role": "member"})
    assert res.status_code == 409


def test_update_member_role_officer_forbidden(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    officer = _user(db, "roleupdateofficer@example.com", password="OfficerPass123!")
    member = _user(db, "roleupdatemember5@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=officer.id, role="officer"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "roleupdateofficer@example.com", "OfficerPass123!")

    assert client.patch(f"/chapters/{chapter.id}/members/{member.id}/", json={"role": "lead"}).status_code == 403


def test_update_member_role_non_lead_forbidden(client, td_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    member = _user(db, "member5@example.com", password="MemberPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.patch(f"/chapters/{chapter.id}/members/{member.id}/", json={"role": "lead"}).status_code == 403


# ---------------------------------------------------------------------------
# GET /chapters/{chapter_id}/members/{user_id}/profile/ — chapter lead only
# ---------------------------------------------------------------------------

def test_get_member_profile_lead_can_access(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "profilelead@example.com", password="LeadPass123!")
    member = _user(db, "profilemember@example.com", major="Computer Science")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "profilelead@example.com", "LeadPass123!")

    res = client.get(f"/chapters/{chapter.id}/members/{member.id}/profile/")
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == member.id
    assert data["major"] == "Computer Science"
    assert data["role"] == "member"
    assert "email_verified" not in data


def test_get_member_profile_officer_forbidden(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    officer = _user(db, "profileofficer@example.com", password="OfficerPass123!")
    member = _user(db, "profilemember2@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=officer.id, role="officer"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "profileofficer@example.com", "OfficerPass123!")

    assert client.get(f"/chapters/{chapter.id}/members/{member.id}/profile/").status_code == 403


def test_get_member_profile_non_lead_forbidden(client, td_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    member = _user(db, "member6@example.com", password="MemberPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.get(f"/chapters/{chapter.id}/members/{member.id}/profile/").status_code == 403


# ---------------------------------------------------------------------------
# Chapter join code endpoints — chapter lead only
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


def test_get_join_codes_officer_forbidden(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    officer = _user(db, "joinofficer@example.com", password="OfficerPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=officer.id, role="officer"))
    db.commit()
    login(client, "joinofficer@example.com", "OfficerPass123!")

    assert client.get(f"/chapters/{chapter.id}/join-codes/").status_code == 403


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
    assert data["use_count"] == 0

    created = db.query(ChapterJoinCode).filter_by(id=data["id"]).first()
    assert created is not None
    assert created.label == "Spring 2026"


def test_create_join_code_never_expires_when_omitted(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "joincreator2@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    login(client, "joincreator2@example.com", "LeadPass123!")

    res = client.post(f"/chapters/{chapter.id}/join-codes/", json={})
    assert res.status_code == 201
    assert res.json()["expires_at"] is None


def test_update_join_code_can_change_label_without_deactivating(client, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "joinlabellead@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    join_code = _join_code(db, chapter.id, lead.id, code="LABELUP1")
    login(client, "joinlabellead@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/join-codes/{join_code.id}/", json={"label": "Updated Label"})
    assert res.status_code == 200
    data = res.json()
    assert data["label"] == "Updated Label"
    assert data["is_active"] is True


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

    res = client.delete(f"/chapters/{chapter.id}/join-codes/{join_code.id}/")
    assert res.status_code == 204

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

    res = client.delete(f"/chapters/{chapter.id}/join-codes/{join_code.id}/")
    assert res.status_code == 400


def test_reactivate_join_code_ignored_by_patch(client, db):
    """is_active isn't a PATCH field anymore — there's no reactivate endpoint at
    all, so sending it is silently ignored rather than validated-and-rejected."""
    university = _university(db)
    chapter = _chapter(db, university.id)
    lead = _user(db, "joinlead4@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    join_code = _join_code(db, chapter.id, lead.id, code="REACT001", is_active=False)
    login(client, "joinlead4@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/join-codes/{join_code.id}/", json={"is_active": True})
    assert res.status_code == 200
    assert res.json()["is_active"] is False

    refreshed = db.query(ChapterJoinCode).filter_by(id=join_code.id).first()
    assert refreshed.is_active is False


# ---------------------------------------------------------------------------
# POST /chapters/join/ — authenticated
# ---------------------------------------------------------------------------

def test_join_chapter_success_increments_use_count(client, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    join_code = _join_code(db, chapter.id, admin_user.id, code="USECOUNT")
    assert join_code.use_count == 0

    joiner = _user(db, "usecountjoiner@example.com", password="JoinPass123!")
    login(client, "usecountjoiner@example.com", "JoinPass123!")

    res = client.post("/chapters/join/?code=USECOUNT")
    assert res.status_code == 201
    data = res.json()
    assert data["id"] == joiner.id
    assert data["role"] == "member"

    db.refresh(join_code)
    assert join_code.use_count == 1


def test_join_chapter_requires_authentication(client):
    res = client.post("/chapters/join/?code=JOIN1234")

    assert res.status_code == 401


def test_join_chapter_rejects_missing_code(client, td_user):
    login(client, "td@test.com", "tdpass")

    res = client.post("/chapters/join/")

    assert res.status_code == 422


@pytest.mark.parametrize("code", ["SHORT", "TOO-LONG9", "UNKNOWN1"])
def test_join_chapter_rejects_code_that_does_not_exist(client, td_user, code):
    """No length validation on `code` anymore — a short/long/unknown code is
    just a lookup miss, same generic 400 as any other invalid code."""
    login(client, "td@test.com", "tdpass")

    res = client.post(f"/chapters/join/?code={code}")

    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid or expired join code"


def test_join_chapter_rejects_existing_member(client, td_user, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=td_user.id, role="member"))
    db.commit()
    login(client, "td@test.com", "tdpass")

    res = client.post("/chapters/join/?code=JOIN1234")

    assert res.status_code == 400
    assert res.json()["detail"] == "User is already a member of a chapter"


def test_join_chapter_rejects_deactivated_code(client, td_user, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    _join_code(db, chapter.id, admin_user.id, code="INACTIVE", is_active=False)
    login(client, "td@test.com", "tdpass")

    res = client.post("/chapters/join/?code=INACTIVE")

    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid or expired join code"


def test_join_chapter_rejects_expired_code(client, td_user, admin_user, db):
    university = _university(db)
    chapter = _chapter(db, university.id)
    expired_at = datetime.now(timezone.utc) - timedelta(hours=1)
    _join_code(db, chapter.id, admin_user.id, code="EXPIRED1", expires_at=expired_at)
    login(client, "td@test.com", "tdpass")

    res = client.post("/chapters/join/?code=EXPIRED1")

    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid or expired join code"


def test_join_chapter_handles_membership_integrity_conflict(client, td_user, admin_user, db, monkeypatch):
    university = _university(db)
    chapter = _chapter(db, university.id)
    _join_code(db, chapter.id, admin_user.id)
    login(client, "td@test.com", "tdpass")

    def raise_integrity_error():
        raise IntegrityError("INSERT INTO chapter_memberships", {}, Exception("duplicate membership"))

    monkeypatch.setattr(db, "commit", raise_integrity_error)
    res = client.post("/chapters/join/?code=JOIN1234")

    assert res.status_code == 400
    assert res.json()["detail"] == "User is already a member of a chapter"
