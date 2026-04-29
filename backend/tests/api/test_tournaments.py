"""Tests for /tournaments endpoints."""
import pytest
from fastapi.testclient import TestClient
from tests.conftest import login
from app.core.permissions import DEFAULT_POSITIONS, DEFAULT_CATEGORIES
from app.models.models import Membership, Tournament

SAMPLE_VOLUNTEER_SCHEMA = {
    "custom_fields": [
        {"key": "transportation", "label": "How will you get there?", "type": "string"},
        {"key": "age_verified",   "label": "Age verified",             "type": "boolean"},
        {"key": "carpool_seats",  "label": "Seats available",          "type": "integer"},
    ]
}


# ---------------------------------------------------------------------------
# GET /tournaments/ — admin only
# ---------------------------------------------------------------------------

def test_list_all_tournaments_admin_only(client, admin_user, td_user, td_tournament):
    login(client, "admin@test.com", "adminpass")
    response = client.get("/tournaments/")
    assert response.status_code == 200
    assert any(t["id"] == td_tournament.id for t in response.json())


def test_list_all_tournaments_non_admin_forbidden(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get("/tournaments/").status_code == 403


def test_list_all_tournaments_unauthenticated(client):
    assert client.get("/tournaments/").status_code == 401


# ---------------------------------------------------------------------------
# GET /tournaments/me/ — user's own tournaments
# ---------------------------------------------------------------------------

def test_list_my_tournaments_returns_own(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.get("/tournaments/me/")
    assert response.status_code == 200
    assert td_tournament.id in [t["id"] for t in response.json()]


def test_list_my_tournaments_excludes_others(
    client, td_user, td_tournament, other_user, other_tournament
):
    login(client, "td@test.com", "tdpass")
    ids = [t["id"] for t in client.get("/tournaments/me/").json()]
    assert td_tournament.id in ids
    assert other_tournament.id not in ids


def test_list_my_tournaments_includes_volunteer_membership(
    client, td_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    ids = [t["id"] for t in client.get("/tournaments/me/").json()]
    assert other_tournament.id in ids


def test_list_my_tournaments_admin_sees_all(
    client, admin_user, td_tournament, other_tournament
):
    login(client, "admin@test.com", "adminpass")
    ids = [t["id"] for t in client.get("/tournaments/me/").json()]
    assert td_tournament.id in ids
    assert other_tournament.id in ids


def test_list_my_tournaments_unauthenticated(client):
    assert client.get("/tournaments/me/").status_code == 401


# ---------------------------------------------------------------------------
# POST /tournaments/ — any authenticated user
# ---------------------------------------------------------------------------

def test_create_tournament_minimal(client, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={"name": "Minimal Tournament"})
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Minimal Tournament"
    assert data["time_blocks"] == []
    assert len(data["categories"]) == len(DEFAULT_CATEGORIES)


def test_create_tournament_auto_populates_default_positions(client, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={"name": "Auto Positions"})
    assert response.status_code == 201
    schema = response.json()["volunteer_schema"]
    assert "positions" in schema
    keys = [p["key"] for p in schema["positions"]]
    assert "tournament_director" in keys
    assert "event_supervisor" in keys


def test_create_tournament_auto_creates_td_membership(client, td_user, db):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={"name": "Auto Membership"})
    assert response.status_code == 201
    tournament_id = response.json()["id"]
    membership = db.query(Membership).filter(
        Membership.user_id == td_user.id,
        Membership.tournament_id == tournament_id,
    ).first()
    assert membership is not None
    assert "tournament_director" in membership.positions


def test_create_tournament_full(client, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={
        "name": "Nationals 2025",
        "start_date": "2025-05-21T08:00:00",
        "end_date": "2025-05-23T18:00:00",
        "location": "USC",
        "volunteer_schema": SAMPLE_VOLUNTEER_SCHEMA,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Nationals 2025"
    assert data["location"] == "USC"
    assert len(data["volunteer_schema"]["custom_fields"]) == 3
    assert data["time_blocks"] == []
    assert len(data["categories"]) == len(DEFAULT_CATEGORIES)


def test_create_tournament_invalid_dates(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.post("/tournaments/", json={
        "name": "Bad Dates",
        "start_date": "2025-11-15T08:00:00",
        "end_date": "2025-11-14T08:00:00",
    }).status_code == 422


def test_create_tournament_unauthenticated(client):
    assert client.post("/tournaments/", json={"name": "Sneaky"}).status_code == 401


# ---------------------------------------------------------------------------
# GET /tournaments/{id}/ — any member
# ---------------------------------------------------------------------------

def test_get_tournament_member_can_access(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/")
    assert response.status_code == 200
    assert response.json()["name"] == td_tournament.name


def test_get_tournament_response_includes_time_blocks_and_categories(
    client, td_user, td_tournament
):
    """TournamentRead must include time_blocks list and seeded categories."""
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/").json()
    assert "time_blocks" in data
    assert isinstance(data["time_blocks"], list)
    assert "categories" in data
    category_names = {c["name"] for c in data["categories"]}
    assert set(DEFAULT_CATEGORIES) <= category_names


def test_get_tournament_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/").status_code == 404


def test_get_tournament_admin_can_access_any(client, admin_user, td_tournament):
    login(client, "admin@test.com", "adminpass")
    assert client.get(f"/tournaments/{td_tournament.id}/").status_code == 200


def test_get_tournament_volunteer_member_can_access(
    client, td_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/").status_code == 200


def test_get_tournament_not_found(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/tournaments/9999/").status_code == 404


# ---------------------------------------------------------------------------
# PATCH /tournaments/{id}/ — manage_tournament only
# ---------------------------------------------------------------------------

def test_update_tournament_td_can_patch(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.patch(f"/tournaments/{td_tournament.id}/", json={"name": "New Name"})
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"


def test_update_tournament_volunteer_member_cannot_patch(
    client, td_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert client.patch(
        f"/tournaments/{other_tournament.id}/", json={"name": "Sneaky"}
    ).status_code == 403


def test_update_tournament_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.patch(
        f"/tournaments/{other_tournament.id}/", json={"name": "Ghost"}
    ).status_code == 404


def test_update_tournament_positions(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    custom_positions = [
        {"key": "tournament_director", "label": "TD", "permissions": ["manage_tournament"]},
        {"key": "my_custom_role", "label": "Custom Role", "permissions": []},
    ]
    response = client.patch(f"/tournaments/{td_tournament.id}/", json={
        "volunteer_schema": {"custom_fields": [], "positions": custom_positions}
    })
    assert response.status_code == 200
    keys = [p["key"] for p in response.json()["volunteer_schema"]["positions"]]
    assert "my_custom_role" in keys


# ---------------------------------------------------------------------------
# DELETE /tournaments/{id}/ — owner or admin only
# ---------------------------------------------------------------------------

def test_delete_tournament_owner_can_delete(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/").status_code == 204


def test_delete_tournament_admin_can_delete(client, admin_user, td_tournament):
    login(client, "admin@test.com", "adminpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/").status_code == 204


def test_delete_tournament_non_owner_member_cannot_delete(
    client, td_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["tournament_director"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{other_tournament.id}/").status_code == 403


def test_delete_tournament_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{other_tournament.id}/").status_code == 404


def test_delete_tournament_not_found(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.delete("/tournaments/9999/").status_code == 404