"""Tests for chapter join-code management endpoints
(app/api/routes/chapter/join_codes.py). Redemption via POST /join/ is
covered in tests/api/test_join.py, alongside the tournament case."""
from tests.conftest import login
from tests.api.chapter._helpers import make_chapter, make_join_code, make_university, make_user
from app.models.models import ChapterMembership, JoinCode


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

    created = db.query(JoinCode).filter_by(id=data["id"]).first()
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
    join_code = JoinCode(
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

    refreshed = db.query(JoinCode).filter_by(id=join_code.id).first()
    assert refreshed is not None
    assert refreshed.is_active is False


def test_deactivate_join_code_twice_rejected(client, db):
    university = make_university(db)
    chapter = make_chapter(db, university.id)
    lead = make_user(db, "joinlead3@example.com", password="LeadPass123!")
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=lead.id, role="lead"))
    join_code = JoinCode(
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

    refreshed = db.query(JoinCode).filter_by(id=join_code.id).first()
    assert refreshed.is_active is False
