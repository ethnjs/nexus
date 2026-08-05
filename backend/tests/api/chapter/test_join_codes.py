"""Tests for chapter join-code endpoints (app/api/routes/chapter/join_codes.py)."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from tests.conftest import login
from tests.api.chapter._helpers import make_chapter, make_join_code, make_university, make_user
from app.models.models import ChapterJoinCode, ChapterMembership


# ---------------------------------------------------------------------------
# Chapter join code endpoints — chapter lead only
# ---------------------------------------------------------------------------

def test_get_join_codes_lead_can_access(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "joinlead@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    login(client, "joinlead@example.com", "LeadPass123!")

    res = client.get(f"/chapters/{chapter.id}/join-codes/")
    assert res.status_code == 200


def test_get_join_codes_officer_forbidden(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    officer = make_user(db, "joinofficer@example.com", password="OfficerPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=officer.id, role="officer"))
    db.commit()
    login(client, "joinofficer@example.com", "OfficerPass123!")

    assert client.get(f"/chapters/{chapter.id}/join-codes/").status_code == 403


def test_get_join_codes_non_lead_forbidden(client, td_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    login(client, "td@test.com", "tdpass")

    assert client.get(f"/chapters/{chapter.id}/join-codes/").status_code == 403


def test_create_join_code_creates_record(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "joincreator@example.com", password="LeadPass123!")
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
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "joincreator2@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    db.commit()
    login(client, "joincreator2@example.com", "LeadPass123!")

    res = client.post(f"/chapters/{chapter.id}/join-codes/", json={})
    assert res.status_code == 201
    assert res.json()["expires_at"] is None


def test_update_join_code_can_change_label_without_deactivating(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "joinlabellead@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    join_code = make_join_code(db, chapter.id, lead.id, code="LABELUP1")
    login(client, "joinlabellead@example.com", "LeadPass123!")

    res = client.patch(f"/chapters/{chapter.id}/join-codes/{join_code.id}/", json={"label": "Updated Label"})
    assert res.status_code == 200
    data = res.json()
    assert data["label"] == "Updated Label"
    assert data["is_active"] is True


def test_deactivate_join_code_marks_inactive(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "joinlead2@example.com", password="LeadPass123!")
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
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "joinlead3@example.com", password="LeadPass123!")
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
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "joinlead4@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    join_code = make_join_code(db, chapter.id, lead.id, code="REACT001", is_active=False)
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
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    join_code = make_join_code(db, chapter.id, admin_user.id, code="USECOUNT")
    assert join_code.use_count == 0

    joiner = make_user(db, "usecountjoiner@example.com", password="JoinPass123!")
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
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=td_user.id, role="member"))
    db.commit()
    login(client, "td@test.com", "tdpass")

    res = client.post("/chapters/join/?code=JOIN1234")

    assert res.status_code == 400
    assert res.json()["detail"] == "User is already a member of a chapter"


def test_join_chapter_rejects_deactivated_code(client, td_user, admin_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    make_join_code(db, chapter.id, admin_user.id, code="INACTIVE", is_active=False)
    login(client, "td@test.com", "tdpass")

    res = client.post("/chapters/join/?code=INACTIVE")

    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid or expired join code"


def test_join_chapter_rejects_expired_code(client, td_user, admin_user, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    expired_at = datetime.now(timezone.utc) - timedelta(hours=1)
    make_join_code(db, chapter.id, admin_user.id, code="EXPIRED1", expires_at=expired_at)
    login(client, "td@test.com", "tdpass")

    res = client.post("/chapters/join/?code=EXPIRED1")

    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid or expired join code"


def test_join_chapter_handles_membership_integrity_conflict(client, td_user, admin_user, db, monkeypatch):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    make_join_code(db, chapter.id, admin_user.id)
    login(client, "td@test.com", "tdpass")

    def raise_integrity_error():
        raise IntegrityError("INSERT INTO chapter_memberships", {}, Exception("duplicate membership"))

    monkeypatch.setattr(db, "commit", raise_integrity_error)
    res = client.post("/chapters/join/?code=JOIN1234")

    assert res.status_code == 400
    assert res.json()["detail"] == "User is already a member of a chapter"
