"""Tests for /api/v1/events endpoints."""

import pytest
from fastapi.testclient import TestClient
from tests.conftest import login


def _make_tournament(client: TestClient) -> dict:
    return client.post("/api/v1/tournaments/", json={"name": "Test Tournament"}).json()


def _make_event(client: TestClient, tournament_id: int, **overrides) -> dict:
    payload = {
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
        "event_type": "standard",
        "category": "Technology & Engineering",
        "building": "Baxter Hall",
        "room": "101",
        "floor": "1",
        "volunteers_needed": 3,
        "blocks": [1, 2, 3, 4, 5, 6],
    }
    payload.update(overrides)
    return client.post("/api/v1/events/", json=payload)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def test_create_event(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    print(t)
    response = _make_event(client, t["id"])
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Boomilever"
    assert data["division"] == "C"
    assert data["event_type"] == "standard"
    assert data["blocks"] == [1, 2, 3, 4, 5, 6]
    assert data["volunteers_needed"] == 3
    assert data["tournament_id"] == t["id"]


def test_create_event_minimal(client: TestClient, td_user):
    """Only required fields — location and blocks are optional."""
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = client.post("/api/v1/events/", json={
        "tournament_id": t["id"],
        "name": "Circuit Lab",
        "division": "C",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["blocks"] == []
    assert data["volunteers_needed"] == 2
    assert data["building"] is None


def test_create_trial_event(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_event(client, t["id"], name="New Trial Event", event_type="trial")
    assert response.status_code == 201
    assert response.json()["event_type"] == "trial"


def test_create_event_division_b(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_event(client, t["id"], name="Boomilever", division="B")
    assert response.status_code == 201
    assert response.json()["division"] == "B"


def test_create_event_invalid_division(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_event(client, t["id"], division="D")
    assert response.status_code == 422


def test_create_event_invalid_type(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_event(client, t["id"], event_type="fake")
    assert response.status_code == 422


def test_create_event_invalid_volunteers_needed(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_event(client, t["id"], volunteers_needed=0)
    assert response.status_code == 422


def test_create_event_duplicate_blocks(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_event(client, t["id"], blocks=[1, 1, 2])
    assert response.status_code == 422


def test_create_event_invalid_tournament(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = _make_event(client, 9999)
    assert response.status_code == 404


def test_create_duplicate_event_same_division(client: TestClient, td_user):
    """Same name + division in same tournament should fail."""
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    _make_event(client, t["id"])
    response = _make_event(client, t["id"])  # duplicate
    assert response.status_code == 409


def test_create_same_event_different_division(client: TestClient, td_user):
    """Same event name but different division is allowed (B and C run separately)."""
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    _make_event(client, t["id"], division="B")
    response = _make_event(client, t["id"], division="C")
    assert response.status_code == 201


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def test_list_events(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    _make_event(client, t["id"], name="Boomilever", division="C")
    _make_event(client, t["id"], name="Circuit Lab", division="C")
    _make_event(client, t["id"], name="Anatomy", division="B")
    response = client.get(f"/api/v1/events/tournament/{t['id']}")
    assert response.status_code == 200
    events = response.json()
    assert len(events) == 3
    # Should be ordered by division then name: B first, then C alphabetically
    assert events[0]["division"] == "B"
    assert events[1]["name"] == "Boomilever"
    assert events[2]["name"] == "Circuit Lab"


def test_list_events_empty(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = client.get(f"/api/v1/events/tournament/{t['id']}")
    assert response.status_code == 200
    assert response.json() == []


def test_list_events_invalid_tournament(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.get("/api/v1/events/tournament/9999")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Get
# ---------------------------------------------------------------------------

def test_get_event(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    created = _make_event(client, t["id"]).json()
    response = client.get(f"/api/v1/events/{created['id']}")
    assert response.status_code == 200
    assert response.json()["name"] == "Boomilever"


def test_get_event_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.get("/api/v1/events/9999")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_update_event_location(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    created = _make_event(client, t["id"]).json()
    response = client.patch(f"/api/v1/events/{created['id']}", json={
        "building": "New Hall",
        "room": "205",
        "floor": "2",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["building"] == "New Hall"
    assert data["room"] == "205"


def test_update_event_blocks(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    created = _make_event(client, t["id"]).json()
    response = client.patch(f"/api/v1/events/{created['id']}", json={
        "blocks": [1, 2, 3]
    })
    assert response.status_code == 200
    assert response.json()["blocks"] == [1, 2, 3]


def test_update_event_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.patch("/api/v1/events/9999", json={"name": "Ghost"})
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_event(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    created = _make_event(client, t["id"]).json()
    assert client.delete(f"/api/v1/events/{created['id']}").status_code == 204
    assert client.get(f"/api/v1/events/{created['id']}").status_code == 404


def test_delete_event_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.delete("/api/v1/events/9999").status_code == 404


def test_delete_tournament_cascades_to_events(client: TestClient, td_user):
    """Deleting a tournament should delete all its events."""
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    event = _make_event(client, t["id"]).json()
    client.delete(f"/api/v1/tournaments/{t['id']}")
    assert client.get(f"/api/v1/events/{event['id']}").status_code == 404