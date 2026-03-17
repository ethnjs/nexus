"""Tests for tournament routes."""

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
    response = client.get("/tournaments/")
    assert response.status_code == 200
    assert response.json() == []


def test_create_tournament_minimal(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={"name": "Minimal Tournament"})
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Minimal Tournament"
    assert data["start_date"] is None
    assert data["end_date"] is None
    assert data["location"] is None
    assert data["blocks"] == []
    assert data["volunteer_schema"] == {"custom_fields": []}


def test_create_tournament_full(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={
        "name": "Full Tournament",
        "location": "USC, Los Angeles CA",
        "start_date": "2026-05-21T08:00:00",
        "end_date": "2026-05-23T18:00:00",
        "blocks": SAMPLE_BLOCKS,
        "volunteer_schema": SAMPLE_VOLUNTEER_SCHEMA,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Full Tournament"
    assert data["location"] == "USC, Los Angeles CA"
    assert len(data["blocks"]) == 8
    assert len(data["volunteer_schema"]["custom_fields"]) == 3


def test_get_tournament(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = client.post("/tournaments/", json={"name": "Fetch Me"}).json()
    response = client.get(f"/tournaments/{created['id']}/")
    assert response.status_code == 200
    assert response.json()["name"] == "Fetch Me"


def test_get_tournament_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.get("/tournaments/9999/")
    assert response.status_code == 404


def test_list_tournaments_multiple(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    client.post("/tournaments/", json={"name": "Tournament A"})
    client.post("/tournaments/", json={"name": "Tournament B"})
    response = client.get("/tournaments/")
    assert response.status_code == 200
    assert len(response.json()) == 2


# ---------------------------------------------------------------------------
# PATCH
# ---------------------------------------------------------------------------

def test_update_tournament_name(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = client.post("/tournaments/", json={"name": "Old Name"}).json()
    response = client.patch(f"/tournaments/{created['id']}/", json={"name": "New Name"})
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"


def test_update_tournament_add_blocks(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = client.post("/tournaments/", json={"name": "No Blocks Yet"}).json()
    assert created["blocks"] == []
    response = client.patch(f"/tournaments/{created['id']}/", json={"blocks": SAMPLE_BLOCKS})
    assert response.status_code == 200
    assert len(response.json()["blocks"]) == 8


def test_update_tournament_add_custom_fields(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = client.post("/tournaments/", json={"name": "No Schema Yet"}).json()
    response = client.patch(
        f"/tournaments/{created['id']}/",
        json={"volunteer_schema": SAMPLE_VOLUNTEER_SCHEMA}
    )
    assert response.status_code == 200
    assert len(response.json()["volunteer_schema"]["custom_fields"]) == 3


def test_update_tournament_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.patch("/tournaments/9999/", json={"name": "Ghost"})
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------

def test_delete_tournament(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = client.post("/tournaments/", json={"name": "Delete Me"}).json()
    assert client.delete(f"/tournaments/{created['id']}/").status_code == 204
    assert client.get(f"/tournaments/{created['id']}/").status_code == 404


def test_delete_tournament_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.delete("/tournaments/9999/")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------

def test_unauthenticated_cannot_list(client: TestClient):
    response = client.get("/tournaments/")
    assert response.status_code == 401


def test_unauthenticated_cannot_create(client: TestClient):
    response = client.post("/tournaments/", json={"name": "Sneaky"})
    assert response.status_code == 401


def test_td_cannot_access_other_tournament(client: TestClient, td_user, other_td, db):
    login(client, "td@test.com", "tdpass")
    created = client.post("/tournaments/", json={"name": "Mine"}).json()
    client.post("/auth/logout/")

    login(client, "other@test.com", "otherpass")
    response = client.get(f"/tournaments/{created['id']}/")
    assert response.status_code == 404