"""Tests for GET/PATCH /chapters/{chapter_id}/ (app/api/routes/chapter/__init__.py)."""
from tests.conftest import login
from tests.api.chapter._helpers import make_chapter, make_university, make_user
from app.models.models import ChapterMembership


# ---------------------------------------------------------------------------
# GET /chapters/{chapter_id}/ — public
# ---------------------------------------------------------------------------

def test_get_chapter_is_public(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)

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
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    login(client, "admin@test.com", "adminpass")

    res = client.patch(f"/chapters/{chapter.id}/", json={"name": "Renamed Chapter"})
    assert res.status_code == 200
    assert res.json()["name"] == "Renamed Chapter"


def test_update_chapter_lead_can_change_name(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "updatelead@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    login(client, "updatelead@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/", json={"name": "Lead Renamed"})
    assert res.status_code == 200
    assert res.json()["name"] == "Lead Renamed"


def test_update_chapter_non_lead_non_admin_forbidden(client, td_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    login(client, "td@test.com", "tdpass")

    assert client.patch(f"/chapters/{chapter.id}/", json={"name": "Sneaky"}).status_code == 403


def test_update_chapter_not_found(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    assert client.patch("/chapters/9999/", json={"name": "Ghost"}).status_code == 404
