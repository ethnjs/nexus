"""Tests for /universities and /admin/universities endpoints."""
import uuid

from tests.conftest import login
from app.models.models import AlumniChapter, University


def _university(db, **kwargs):
    defaults = {"name": f"Test University {uuid.uuid4()}", "abbreviation": "TU", "location": "Test City"}
    defaults.update(kwargs)
    university = University(**defaults)
    db.add(university)
    db.commit()
    db.refresh(university)
    return university


# ---------------------------------------------------------------------------
# GET /universities/ — public
# ---------------------------------------------------------------------------

def test_get_universities_returns_created_university(client, db):
    university = _university(db)
    res = client.get("/universities/")
    assert res.status_code == 200
    assert any(item["name"] == university.name for item in res.json())


# ---------------------------------------------------------------------------
# POST /admin/universities/ — admin only
# ---------------------------------------------------------------------------

def test_create_university_creates_record(client, admin_user, db):
    login(client, "admin@test.com", "adminpass")
    unique_name = f"New University {uuid.uuid4()}"
    res = client.post("/admin/universities/", json={
        "name": unique_name, "abbreviation": "NU", "location": "Nowhere",
    })
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == unique_name
    assert data["abbreviation"] == "NU"
    assert data["location"] == "Nowhere"

    fetched = db.query(University).filter_by(id=data["id"]).first()
    assert fetched is not None
    assert fetched.name == unique_name


def test_create_university_rejects_duplicate_name(client, admin_user, db):
    login(client, "admin@test.com", "adminpass")
    unique_name = f"Duplicate University {uuid.uuid4()}"
    body = {"name": unique_name, "abbreviation": "DU", "location": "City"}

    assert client.post("/admin/universities/", json=body).status_code == 201
    assert client.post("/admin/universities/", json=body).status_code == 409


def test_create_university_non_admin_forbidden(client, td_user):
    login(client, "td@test.com", "tdpass")
    res = client.post("/admin/universities/", json={"name": "Sneaky U"})
    assert res.status_code == 403


def test_create_university_unauthenticated(client):
    res = client.post("/admin/universities/", json={"name": "Sneaky U"})
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# DELETE /universities — admin only
# ---------------------------------------------------------------------------

def test_delete_university_removes_record(client, admin_user, db):
    university = _university(db)
    login(client, "admin@test.com", "adminpass")

    res = client.delete(f"/universities?university_id={university.id}")
    assert res.status_code == 204
    assert db.query(University).filter_by(id=university.id).first() is None


def test_delete_university_referenced_by_chapter_conflicts(client, admin_user, db):
    university = _university(db)
    db.add(AlumniChapter(name="Test Chapter", university_id=university.id))
    db.commit()
    login(client, "admin@test.com", "adminpass")

    res = client.delete(f"/universities?university_id={university.id}")
    assert res.status_code == 409
    assert db.query(University).filter_by(id=university.id).first() is not None


def test_delete_university_not_found(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    assert client.delete("/universities?university_id=9999").status_code == 404


def test_delete_university_non_admin_forbidden(client, td_user, db):
    university = _university(db)
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/universities?university_id={university.id}").status_code == 403
