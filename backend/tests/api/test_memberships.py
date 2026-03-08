"""Tests for /api/v1/memberships endpoints."""

import pytest
from fastapi.testclient import TestClient
from tests.conftest import login


def _make_tournament(client: TestClient) -> dict:
    return client.post("/api/v1/tournaments/", json={"name": "Test Tournament"}).json()


def _make_user(client: TestClient, email: str = "alice@example.com") -> dict:
    return client.post("/api/v1/users/", json={
        "first_name": "Alice", "last_name": "Smith", "email": email
    }).json()


def _make_event(client: TestClient, tournament_id: int) -> dict:
    return client.post("/api/v1/events/", json={
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
        "blocks": [1, 2, 3, 4, 5, 6],
    }).json()


def _make_membership(client: TestClient, user_id: int, tournament_id: int, **overrides) -> dict:
    payload = {
        "user_id": user_id,
        "tournament_id": tournament_id,
        "status": "interested",
    }
    payload.update(overrides)
    return client.post("/api/v1/memberships/", json=payload)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def test_create_membership_minimal(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    response = _make_membership(client, u["id"], t["id"])
    assert response.status_code == 201
    data = response.json()
    assert data["user_id"] == u["id"]
    assert data["tournament_id"] == t["id"]
    assert data["status"] == "interested"
    assert data["assigned_event_id"] is None
    assert data["roles"] is None


def test_create_membership_full(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    e = _make_event(client, t["id"])
    response = _make_membership(client, u["id"], t["id"],
        assigned_event_id=e["id"],
        status="assigned",
        roles={"event_supervisor": [1, 2, 3, 4, 5, 6]},
        role_preference=["event_volunteer"],
        event_preference=["Boomilever", "Hovercraft"],
        general_volunteer_interest=["STEM Expo"],
        availability=[
            {"date": "2026-05-21", "start": "08:00", "end": "10:00"},
            {"date": "2026-05-23", "start": "08:00", "end": "18:00"},
        ],
        lunch_order="Veggie Wrap",
        notes="Allergic to nuts",
        extra_data={"transportation": "Driving", "carpool_seats": 3},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["assigned_event_id"] == e["id"]
    assert data["roles"] == {"event_supervisor": [1, 2, 3, 4, 5, 6]}
    assert data["event_preference"] == ["Boomilever", "Hovercraft"]
    assert len(data["availability"]) == 2
    assert data["availability"][0]["date"] == "2026-05-21"
    assert data["extra_data"]["transportation"] == "Driving"


def test_create_membership_invalid_status(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    response = _make_membership(client, u["id"], t["id"], status="fake_status")
    assert response.status_code == 422


def test_create_membership_invalid_role(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    response = _make_membership(client, u["id"], t["id"],
        roles={"fake_role": [1, 2, 3]}
    )
    assert response.status_code == 422


def test_create_membership_invalid_user(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    response = _make_membership(client, 9999, t["id"])
    assert response.status_code == 404


def test_create_membership_invalid_tournament(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    u = _make_user(client)
    response = _make_membership(client, u["id"], 9999)
    assert response.status_code == 404


def test_create_membership_event_wrong_tournament(client: TestClient, td_user):
    """Assigned event must belong to the same tournament."""
    login(client, "td@test.com", "tdpass")
    t1 = _make_tournament(client)
    t2 = client.post("/api/v1/tournaments/", json={"name": "Other Tournament"}).json()
    u = _make_user(client)
    e = _make_event(client, t2["id"])  # event belongs to t2
    response = _make_membership(client, u["id"], t1["id"], assigned_event_id=e["id"])
    assert response.status_code == 404


def test_create_membership_duplicate(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    _make_membership(client, u["id"], t["id"])
    response = _make_membership(client, u["id"], t["id"])  # duplicate
    assert response.status_code == 409


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def test_list_memberships(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u1 = _make_user(client, "alice@example.com")
    u2 = _make_user(client, "bob@example.com")
    _make_membership(client, u1["id"], t["id"])
    _make_membership(client, u2["id"], t["id"])
    response = client.get(f"/api/v1/memberships/tournament/{t['id']}")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_list_memberships_filter_by_status(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u1 = _make_user(client, "alice@example.com")
    u2 = _make_user(client, "bob@example.com")
    _make_membership(client, u1["id"], t["id"], status="interested")
    _make_membership(client, u2["id"], t["id"], status="confirmed")
    response = client.get(f"/api/v1/memberships/tournament/{t['id']}?status=confirmed")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["status"] == "confirmed"


def test_list_memberships_invalid_tournament(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/api/v1/memberships/tournament/9999").status_code == 404


def test_list_memberships_empty(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    assert client.get(f"/api/v1/memberships/tournament/{t['id']}").json() == []


# ---------------------------------------------------------------------------
# Get
# ---------------------------------------------------------------------------

def test_get_membership(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    created = _make_membership(client, u["id"], t["id"]).json()
    response = client.get(f"/api/v1/memberships/{created['id']}")
    assert response.status_code == 200
    assert response.json()["id"] == created["id"]


def test_get_membership_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/api/v1/memberships/9999").status_code == 404


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_update_membership_status(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    created = _make_membership(client, u["id"], t["id"]).json()
    response = client.patch(f"/api/v1/memberships/{created['id']}", json={
        "status": "confirmed"
    })
    assert response.status_code == 200
    assert response.json()["status"] == "confirmed"


def test_update_membership_assign_event(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    e = _make_event(client, t["id"])
    created = _make_membership(client, u["id"], t["id"]).json()
    assert created["assigned_event_id"] is None

    response = client.patch(f"/api/v1/memberships/{created['id']}", json={
        "assigned_event_id": e["id"],
        "roles": {"event_supervisor": [1, 2, 3, 4, 5, 6]},
        "status": "assigned",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["assigned_event_id"] == e["id"]
    assert data["status"] == "assigned"
    assert data["roles"]["event_supervisor"] == [1, 2, 3, 4, 5, 6]


def test_update_membership_roles_multiblock(client: TestClient, td_user):
    """Alan is Lead ES for blocks 1-6, Score Counselor for block 7."""
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    created = _make_membership(client, u["id"], t["id"]).json()
    response = client.patch(f"/api/v1/memberships/{created['id']}", json={
        "roles": {
            "lead_event_supervisor": [1, 2, 3, 4, 5, 6],
            "score_counselor": [7],
        }
    })
    assert response.status_code == 200
    roles = response.json()["roles"]
    assert roles["lead_event_supervisor"] == [1, 2, 3, 4, 5, 6]
    assert roles["score_counselor"] == [7]


def test_update_membership_roles_merges(client: TestClient, td_user):
    """PATCHing roles should merge with existing roles, not replace them."""
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    created = _make_membership(client, u["id"], t["id"],
        roles={"event_supervisor": [1, 2, 3]}
    ).json()
    response = client.patch(f"/api/v1/memberships/{created['id']}", json={
        "roles": {"score_counselor": [7]}
    })
    assert response.status_code == 200
    roles = response.json()["roles"]
    assert roles["event_supervisor"] == [1, 2, 3]
    assert roles["score_counselor"] == [7]


def test_update_membership_extra_data_merges(client: TestClient, td_user):
    """PATCHing extra_data should merge with existing keys, not replace them."""
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    created = _make_membership(client, u["id"], t["id"],
        extra_data={"transportation": "Driving"}
    ).json()
    response = client.patch(f"/api/v1/memberships/{created['id']}", json={
        "extra_data": {"carpool_seats": 3}
    })
    assert response.status_code == 200
    extra = response.json()["extra_data"]
    assert extra["transportation"] == "Driving"
    assert extra["carpool_seats"] == 3


def test_update_membership_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.patch("/api/v1/memberships/9999", json={"status": "confirmed"}).status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_membership(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    created = _make_membership(client, u["id"], t["id"]).json()
    assert client.delete(f"/api/v1/memberships/{created['id']}").status_code == 204
    assert client.get(f"/api/v1/memberships/{created['id']}").status_code == 404


def test_delete_membership_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.delete("/api/v1/memberships/9999").status_code == 404


def test_delete_user_cascades_memberships(client: TestClient, td_user):
    """Deleting a user should remove all their memberships."""
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    m = _make_membership(client, u["id"], t["id"]).json()
    client.delete(f"/api/v1/users/{u['id']}")
    assert client.get(f"/api/v1/memberships/{m['id']}").status_code == 404


def test_delete_tournament_cascades_memberships(client: TestClient, td_user):
    """Deleting a tournament should remove all its memberships."""
    login(client, "td@test.com", "tdpass")
    t = _make_tournament(client)
    u = _make_user(client)
    m = _make_membership(client, u["id"], t["id"]).json()
    client.delete(f"/api/v1/tournaments/{t['id']}")
    assert client.get(f"/api/v1/memberships/{m['id']}").status_code == 404