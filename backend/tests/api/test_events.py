"""Tests for event routes."""

import pytest
from fastapi.testclient import TestClient
from tests.conftest import login


def _make_tournament(client: TestClient) -> dict:
    return client.post("/tournaments/", json={"name": "Test Tournament"}).json()


def _make_event(client: TestClient, tournament_id: int, **overrides) -> dict:
    payload = {
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
        "event_type": "standard",
        "category": "Technology & Engineering",
        "building": "VKC",
        "room": "101",
        "volunteers_needed": 2,
        "blocks": [14, 15],
    }
    payload.update(overrides)
    return client.post("/events/", json=payload)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def test_create_event(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_event(client, t["id"])
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Boomilever"
    assert data["division"] == "C"
    assert data["blocks"] == [14, 15]


def test_create_event_minimal(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = client.post("/events/", json={
        "tournament_id": t["id"],
        "name": "Hovercraft",
        "division": "B",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["volunteers_needed"] == 2  # default
    assert data["blocks"] == []


def test_create_event_duplicate(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    _make_event(client, t["id"])
    response = _make_event(client, t["id"])  # same name + division + tournament
    assert response.status_code == 409


def test_create_event_invalid_division(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_event(client, t["id"], division="D")
    assert response.status_code == 422


def test_create_event_tournament_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = _make_event(client, 9999)
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Get / List
# ---------------------------------------------------------------------------

def test_get_event(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    created = _make_event(client, t["id"]).json()
    response = client.get(f"/events/{created['id']}/")
    assert response.status_code == 200
    assert response.json()["name"] == "Boomilever"


def test_get_event_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/events/9999/").status_code == 404


def test_list_events_by_tournament(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    _make_event(client, t["id"], name="Boomilever", division="C")
    _make_event(client, t["id"], name="Hovercraft", division="B")
    response = client.get(f"/events/tournament/{t['id']}/")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_list_events_empty(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = client.get(f"/events/tournament/{t['id']}/")
    assert response.status_code == 200
    assert response.json() == []


def test_list_events_tournament_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/events/tournament/9999/").status_code == 404


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_update_event(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    created = _make_event(client, t["id"]).json()
    response = client.patch(f"/events/{created['id']}/", json={
        "room": "205",
        "volunteers_needed": 3,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["room"] == "205"
    assert data["volunteers_needed"] == 3
    assert data["name"] == "Boomilever"  # unchanged


def test_update_event_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.patch("/events/9999/", json={"room": "101"}).status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_event(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    created = _make_event(client, t["id"]).json()
    assert client.delete(f"/events/{created['id']}/").status_code == 204
    assert client.get(f"/events/{created['id']}/").status_code == 404


def test_delete_event_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.delete("/events/9999/").status_code == 404


def test_delete_tournament_cascades_events(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    e = _make_event(client, t["id"]).json()
    client.delete(f"/tournaments/{t['id']}/")
    assert client.get(f"/events/{e['id']}/").status_code == 404