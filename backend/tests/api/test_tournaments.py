"""Tests for /api/v1/tournaments endpoints."""

import pytest
from fastapi.testclient import TestClient
from tests.conftest import login

SAMPLE_BLOCKS = [
    {"number": 1, "label": "Block 1", "date": "2025-11-15", "start": "08:00", "end": "09:00"},
    {"number": 2, "label": "Block 2", "date": "2025-11-15", "start": "09:15", "end": "10:15"},
    {"number": 3, "label": "Block 3", "date": "2025-11-15", "start": "10:30", "end": "11:30"},
    {"number": 4, "label": "Block 4", "date": "2025-11-15", "start": "12:30", "end": "13:30"},
    {"number": 5, "label": "Block 5", "date": "2025-11-15", "start": "13:45", "end": "14:45"},
    {"number": 6, "label": "Block 6", "date": "2025-11-15", "start": "15:00", "end": "16:00"},
    {"number": 7, "label": "Scoring", "date": "2025-11-15", "start": "16:15", "end": "17:15"},
    {"number": 8, "label": "Awards",  "date": "2025-11-15", "start": "17:30", "end": "18:30"},
]

SAMPLE_VOLUNTEER_SCHEMA = {
    "custom_fields": [
        {"key": "transportation", "label": "How will you get there?", "type": "string"},
        {"key": "age_verified",   "label": "Age verified",             "type": "boolean"},
        {"key": "carpool_seats",  "label": "Seats available",          "type": "integer"},
    ]
}


# ---------------------------------------------------------------------------
# Basic CRUD
# ---------------------------------------------------------------------------

def test_list_tournaments_empty(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.get("/api/v1/tournaments/")
    assert response.status_code == 200
    assert response.json() == []


def test_create_tournament_minimal(client: TestClient, td_user):
    """Only name is required — everything else has sensible defaults."""
    login(client, "td@test.com", "tdpass")
    response = client.post("/api/v1/tournaments/", json={"name": "Minimal Tournament"})
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Minimal Tournament"
    assert data["start_date"] is None
    assert data["end_date"] is None
    assert data["location"] is None
    assert data["blocks"] == []
    assert data["volunteer_schema"] == {"custom_fields": []}


def test_create_tournament_full(client: TestClient, td_user):
    """Full tournament with blocks and volunteer schema."""
    login(client, "td@test.com", "tdpass")
    payload = {
        "name": "Nationals 2025",
        "start_date": "2025-05-21T08:00:00",
        "end_date": "2025-05-23T18:00:00",
        "location": "USC",
        "blocks": SAMPLE_BLOCKS,
        "volunteer_schema": SAMPLE_VOLUNTEER_SCHEMA,
    }
    response = client.post("/api/v1/tournaments/", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Nationals 2025"
    assert data["location"] == "USC"
    assert len(data["blocks"]) == 8
    assert data["blocks"][0]["label"] == "Block 1"
    assert data["blocks"][6]["label"] == "Scoring"
    assert data["blocks"][7]["label"] == "Awards"
    assert len(data["volunteer_schema"]["custom_fields"]) == 3


def test_create_tournament_multiday(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    payload = {
        "name": "Multi Day Tournament",
        "start_date": "2025-05-21T08:00:00",
        "end_date": "2025-05-23T18:00:00",
    }
    response = client.post("/api/v1/tournaments/", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["start_date"] is not None
    assert data["end_date"] is not None


def test_create_tournament_invalid_dates(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    payload = {
        "name": "Bad Dates",
        "start_date": "2025-11-15T08:00:00",
        "end_date": "2025-11-14T08:00:00",  # before start
    }
    response = client.post("/api/v1/tournaments/", json=payload)
    assert response.status_code == 422


def test_create_tournament_duplicate_block_numbers(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    payload = {
        "name": "Bad Blocks",
        "blocks": [
            {"number": 1, "label": "Block 1", "date": "2025-11-15", "start": "08:00", "end": "09:00"},
            {"number": 1, "label": "Block 1 Again", "date": "2025-11-15", "start": "09:00", "end": "10:00"},
        ]
    }
    response = client.post("/api/v1/tournaments/", json=payload)
    assert response.status_code == 422


def test_create_tournament_invalid_block_time(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    payload = {
        "name": "Bad Block Time",
        "blocks": [
            {"number": 1, "label": "Block 1", "date": "2025-11-15", "start": "25:00", "end": "09:00"},
        ]
    }
    response = client.post("/api/v1/tournaments/", json=payload)
    assert response.status_code == 422


def test_create_tournament_invalid_block_date(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    payload = {
        "name": "Bad Block Date",
        "blocks": [
            {"number": 1, "label": "Block 1", "date": "not-a-date", "start": "08:00", "end": "09:00"},
        ]
    }
    response = client.post("/api/v1/tournaments/", json=payload)
    assert response.status_code == 422


def test_create_tournament_multiday_blocks(client: TestClient, td_user):
    """Blocks can span multiple days for multi-day tournaments like nationals."""
    login(client, "td@test.com", "tdpass")
    payload = {
        "name": "Nationals 2026",
        "start_date": "2026-05-21T08:00:00",
        "end_date": "2026-05-23T18:00:00",
        "location": "USC",
        "blocks": [
            {"number": 1,  "label": "Thu Check-in",  "date": "2026-05-21", "start": "08:00", "end": "10:00"},
            {"number": 2,  "label": "Thu Morning",   "date": "2026-05-21", "start": "10:00", "end": "12:00"},
            {"number": 3,  "label": "Fri Check-in",  "date": "2026-05-22", "start": "08:00", "end": "10:00"},
            {"number": 14, "label": "Sat Block 1",   "date": "2026-05-23", "start": "08:00", "end": "09:00"},
            {"number": 20, "label": "Scoring",       "date": "2026-05-23", "start": "16:00", "end": "17:00"},
            {"number": 21, "label": "Awards",        "date": "2026-05-23", "start": "17:30", "end": "18:30"},
        ]
    }
    response = client.post("/api/v1/tournaments/", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert len(data["blocks"]) == 6
    assert data["blocks"][0]["date"] == "2026-05-21"
    assert data["blocks"][3]["date"] == "2026-05-23"


def test_create_tournament_invalid_custom_field_type(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    payload = {
        "name": "Bad Schema",
        "volunteer_schema": {
            "custom_fields": [
                {"key": "foo", "label": "Foo", "type": "not_a_real_type"}
            ]
        }
    }
    response = client.post("/api/v1/tournaments/", json=payload)
    assert response.status_code == 422


def test_get_tournament(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = client.post("/api/v1/tournaments/", json={"name": "Fetch Me"}).json()
    response = client.get(f"/api/v1/tournaments/{created['id']}")
    assert response.status_code == 200
    assert response.json()["name"] == "Fetch Me"


def test_get_tournament_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.get("/api/v1/tournaments/9999")
    assert response.status_code == 404


def test_list_tournaments_multiple(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    client.post("/api/v1/tournaments/", json={"name": "Tournament A"})
    client.post("/api/v1/tournaments/", json={"name": "Tournament B"})
    response = client.get("/api/v1/tournaments/")
    assert response.status_code == 200
    assert len(response.json()) == 2


# ---------------------------------------------------------------------------
# PATCH
# ---------------------------------------------------------------------------

def test_update_tournament_name(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = client.post("/api/v1/tournaments/", json={"name": "Old Name"}).json()
    response = client.patch(
        f"/api/v1/tournaments/{created['id']}",
        json={"name": "New Name"}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"


def test_update_tournament_add_blocks(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = client.post("/api/v1/tournaments/", json={"name": "No Blocks Yet"}).json()
    assert created["blocks"] == []

    response = client.patch(
        f"/api/v1/tournaments/{created['id']}",
        json={"blocks": SAMPLE_BLOCKS}
    )
    assert response.status_code == 200
    assert len(response.json()["blocks"]) == 8


def test_update_tournament_add_custom_fields(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = client.post("/api/v1/tournaments/", json={"name": "No Schema Yet"}).json()
    response = client.patch(
        f"/api/v1/tournaments/{created['id']}",
        json={"volunteer_schema": SAMPLE_VOLUNTEER_SCHEMA}
    )
    assert response.status_code == 200
    assert len(response.json()["volunteer_schema"]["custom_fields"]) == 3


def test_update_tournament_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.patch("/api/v1/tournaments/9999", json={"name": "Ghost"})
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------

def test_delete_tournament(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = client.post("/api/v1/tournaments/", json={"name": "Delete Me"}).json()
    assert client.delete(f"/api/v1/tournaments/{created['id']}").status_code == 204
    assert client.get(f"/api/v1/tournaments/{created['id']}").status_code == 404


def test_delete_tournament_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.delete("/api/v1/tournaments/9999")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------

def test_unauthenticated_cannot_list(client: TestClient):
    response = client.get("/api/v1/tournaments/")
    assert response.status_code == 401


def test_unauthenticated_cannot_create(client: TestClient):
    response = client.post("/api/v1/tournaments/", json={"name": "Sneaky"})
    assert response.status_code == 401


def test_td_cannot_access_other_td_tournament(client: TestClient, td_user, other_td, db):
    from app.models.models import Tournament
    # Create a tournament directly in DB owned by other_td
    other_tournament = Tournament(
        name="Not Yours",
        owner_id=other_td.id,
        blocks=[],
        volunteer_schema={"custom_fields": []},
    )
    db.add(other_tournament)
    db.commit()
    db.refresh(other_tournament)

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/api/v1/tournaments/{other_tournament.id}")
    assert response.status_code == 404  # 404, not 403 — don't leak existence


def test_admin_can_access_any_tournament(client: TestClient, admin_user, td_user, db):
    from app.models.models import Tournament
    td_tournament = Tournament(
        name="TD's Tournament",
        owner_id=td_user.id,
        blocks=[],
        volunteer_schema={"custom_fields": []},
    )
    db.add(td_tournament)
    db.commit()
    db.refresh(td_tournament)

    login(client, "admin@test.com", "adminpass")
    response = client.get(f"/api/v1/tournaments/{td_tournament.id}")
    assert response.status_code == 200
    assert response.json()["name"] == "TD's Tournament"


def test_td_only_sees_own_in_list(client: TestClient, td_user, other_td, db):
    from app.models.models import Tournament
    db.add(Tournament(name="Mine", owner_id=td_user.id, blocks=[], volunteer_schema={"custom_fields": []}))
    db.add(Tournament(name="Not Mine", owner_id=other_td.id, blocks=[], volunteer_schema={"custom_fields": []}))
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.get("/api/v1/tournaments/")
    assert response.status_code == 200
    names = [t["name"] for t in response.json()]
    assert "Mine" in names
    assert "Not Mine" not in names