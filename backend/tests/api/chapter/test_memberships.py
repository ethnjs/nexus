"""Tests for /chapters/{chapter_id}/members/ endpoints (app/api/routes/chapter/memberships.py)."""
from tests.conftest import login
from tests.api.chapter._helpers import make_chapter, make_university, make_user
from app.models.models import ChapterMembership


# ---------------------------------------------------------------------------
# GET /chapters/{chapter_id}/members/ — chapter officer/lead or admin
# ---------------------------------------------------------------------------

def test_get_members_non_member_forbidden(client, td_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    login(client, "td@test.com", "tdpass")

    assert client.get(f"/chapters/{chapter.id}/members/").status_code == 403


def test_get_members_lead_can_access(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "leadmember@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    login(client, "leadmember@example.com", "LeadPass123!")

    res = client.get(f"/chapters/{chapter.id}/members/")
    assert res.status_code == 200


def test_get_members_officer_can_access(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    officer = make_user(db, "officermember@example.com", password="OfficerPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=officer.id, role="officer"))
    db.commit()
    login(client, "officermember@example.com", "OfficerPass123!")

    res = client.get(f"/chapters/{chapter.id}/members/")
    assert res.status_code == 200


def test_get_members_plain_member_forbidden(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    member = make_user(db, "plainmember@example.com", password="MemberPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "plainmember@example.com", "MemberPass123!")

    assert client.get(f"/chapters/{chapter.id}/members/").status_code == 403


def test_get_members_admin_can_access(client, admin_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    login(client, "admin@test.com", "adminpass")

    assert client.get(f"/chapters/{chapter.id}/members/").status_code == 200


def test_get_members_response_shape_is_flattened(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "shapelead@example.com", password="LeadPass123!")
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
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "deletelead@example.com", password="LeadPass123!")
    member = make_user(db, "deleteme@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "deletelead@example.com", "LeadPass123!")

    res = client.delete(f"/chapters/{chapter.id}/members/{member.id}/")
    assert res.status_code == 204
    assert db.query(ChapterMembership).filter_by(chapter_id=chapter.id, user_id=member.id).first() is None


def test_delete_member_officer_forbidden(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    officer = make_user(db, "deleteofficer@example.com", password="OfficerPass123!")
    member = make_user(db, "deleteme2@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=officer.id, role="officer"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "deleteofficer@example.com", "OfficerPass123!")

    assert client.delete(f"/chapters/{chapter.id}/members/{member.id}/").status_code == 403


def test_delete_member_not_found(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "deletelead2@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    login(client, "deletelead2@example.com", "LeadPass123!")

    assert client.delete(f"/chapters/{chapter.id}/members/9999/").status_code == 404


# ---------------------------------------------------------------------------
# PATCH /chapters/{chapter_id}/members/{user_id}/ — chapter lead only
# ---------------------------------------------------------------------------

def test_update_member_role_lead_can_promote(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "roleupdatelead@example.com", password="LeadPass123!")
    member = make_user(db, "roleupdatemember@example.com")
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
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "roleupdatelead2@example.com", password="LeadPass123!")
    member = make_user(db, "roleupdatemember2@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "roleupdatelead2@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/members/{member.id}/", json={"role": "lead"})
    assert res.status_code == 200
    assert res.json()["role"] == "lead"


def test_update_member_role_rejects_invalid_role(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "roleupdatelead3@example.com", password="LeadPass123!")
    member = make_user(db, "roleupdatemember3@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "roleupdatelead3@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/members/{member.id}/", json={"role": "superadmin"})
    assert res.status_code == 422


def test_update_member_role_already_has_role_conflicts(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "roleupdatelead4@example.com", password="LeadPass123!")
    member = make_user(db, "roleupdatemember4@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "roleupdatelead4@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/members/{member.id}/", json={"role": "member"})
    assert res.status_code == 409


def test_update_member_role_officer_forbidden(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    officer = make_user(db, "roleupdateofficer@example.com", password="OfficerPass123!")
    member = make_user(db, "roleupdatemember5@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=officer.id, role="officer"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "roleupdateofficer@example.com", "OfficerPass123!")

    assert client.patch(f"/chapters/{chapter.id}/members/{member.id}/", json={"role": "lead"}).status_code == 403


def test_update_member_role_non_lead_forbidden(client, td_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    member = make_user(db, "member5@example.com", password="MemberPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.patch(f"/chapters/{chapter.id}/members/{member.id}/", json={"role": "lead"}).status_code == 403


# ---------------------------------------------------------------------------
# GET /chapters/{chapter_id}/members/{user_id}/profile/ — chapter lead only
# ---------------------------------------------------------------------------

def test_get_member_profile_lead_can_access(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "profilelead@example.com", password="LeadPass123!")
    member = make_user(db, "profilemember@example.com", major="Computer Science")
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
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    officer = make_user(db, "profileofficer@example.com", password="OfficerPass123!")
    member = make_user(db, "profilemember2@example.com")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=officer.id, role="officer"))
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "profileofficer@example.com", "OfficerPass123!")

    assert client.get(f"/chapters/{chapter.id}/members/{member.id}/profile/").status_code == 403


def test_get_member_profile_non_lead_forbidden(client, td_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    member = make_user(db, "member6@example.com", password="MemberPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.get(f"/chapters/{chapter.id}/members/{member.id}/profile/").status_code == 403
