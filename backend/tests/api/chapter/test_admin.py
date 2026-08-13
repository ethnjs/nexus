"""Tests for /admin/chapters/ endpoints (app/api/routes/chapter/admin.py)."""
from tests.conftest import login
from tests.api.chapter._helpers import make_chapter, make_university, make_user
from app.models.models import AlumniChapter, ChapterMembership


# ---------------------------------------------------------------------------
# GET /admin/chapters/ — admin only
# ---------------------------------------------------------------------------

def test_list_chapters_admin_only(client, admin_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
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
    university = make_university(db)
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
    university = make_university(db)
    make_chapter(db, university.id, name="Existing Chapter")
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
# POST /admin/chapters/{chapter_id}/leads/ — admin only
# ---------------------------------------------------------------------------

def test_assign_lead_creates_chapter_membership(client, admin_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)

    member = make_user(db, "member@example.com", password="MemberPass123!")

    login(client, "admin@test.com", "adminpass")
    res = client.post(f"/admin/chapters/{chapter.id}/leads/", json={"user_id": member.id})
    assert res.status_code == 201

    membership = db.query(ChapterMembership).filter_by(chapter_id=chapter.id, user_id=member.id).first()
    assert membership is not None
    assert membership.role == "lead"


def test_assign_lead_non_admin_forbidden(client, td_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    member = make_user(db, "member2@example.com", password="MemberPass123!")
    login(client, "td@test.com", "tdpass")

    assert client.post(f"/admin/chapters/{chapter.id}/leads/", json={"user_id": member.id}).status_code == 403


# ---------------------------------------------------------------------------
# DELETE /admin/chapters/{chapter_id}/leads/{user_id}/ — admin only
# ---------------------------------------------------------------------------

def test_remove_lead_marks_member(client, admin_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)

    member = make_user(db, "member3@example.com", password="MemberPass123!")

    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="lead"))
    db.commit()

    login(client, "admin@test.com", "adminpass")
    res = client.delete(f"/admin/chapters/{chapter.id}/leads/{member.id}/")
    assert res.status_code == 204

    membership = db.query(ChapterMembership).filter_by(chapter_id=chapter.id, user_id=member.id).first()
    assert membership is not None
    assert membership.role == "member"


def test_remove_lead_non_admin_forbidden(client, td_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    member = make_user(db, "member4@example.com", password="MemberPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="lead"))
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.delete(f"/admin/chapters/{chapter.id}/leads/{member.id}/").status_code == 403
