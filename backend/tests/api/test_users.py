"""Tests for /users and /tournaments/{id}/users endpoints."""
import pytest
from fastapi.testclient import TestClient
from tests.conftest import login
from app.models.models import Membership


def _make_user(client, email="alice@example.com", **overrides):
    payload = {"first_name": "Alice", "last_name": "Smith", "email": email}
    payload.update(overrides)
    return client.post("/users/", json=payload).json()


# ---------------------------------------------------------------------------
# POST /users/ — admin only
# ---------------------------------------------------------------------------

def test_create_user_admin_only(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    response = client.post("/users/", json={
        "first_name": "Alice", "last_name": "Smith", "email": "alice@example.com",
    })
    assert response.status_code == 201
    assert response.json()["email"] == "alice@example.com"


def test_create_user_non_admin_forbidden(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.post("/users/", json={
        "first_name": "Alice", "last_name": "Smith", "email": "alice@example.com",
    }).status_code == 403


def test_create_user_duplicate_email(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    _make_user(client)
    assert client.post("/users/", json={
        "first_name": "Dup", "last_name": "User", "email": "alice@example.com",
    }).status_code == 409


def test_create_user_unauthenticated(client):
    assert client.post("/users/", json={
        "first_name": "Alice", "last_name": "Smith", "email": "alice@example.com",
    }).status_code == 401


# ---------------------------------------------------------------------------
# GET /users/ — admin only
# ---------------------------------------------------------------------------

def test_list_users_admin_only(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    _make_user(client, "alice@example.com", last_name="Smith")
    _make_user(client, "bob@example.com",   last_name="Adams")
    response = client.get("/users/")
    assert response.status_code == 200
    assert len(response.json()) >= 2


def test_list_users_non_admin_forbidden(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/users/").status_code == 403


def test_list_users_unauthenticated(client):
    assert client.get("/users/").status_code == 401


# ---------------------------------------------------------------------------
# GET /users/{id}/ — admin only
# ---------------------------------------------------------------------------

def test_get_user_admin(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    created = _make_user(client)
    assert client.get(f"/users/{created['id']}/").status_code == 200


def test_get_user_non_admin_forbidden(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/users/1/").status_code == 403


def test_get_user_not_found(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    assert client.get("/users/9999/").status_code == 404


# ---------------------------------------------------------------------------
# GET /users/by-email/{email}/ — admin only
# ---------------------------------------------------------------------------

def test_get_user_by_email_admin(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    _make_user(client)
    assert client.get("/users/by-email/alice@example.com/").status_code == 200


def test_get_user_by_email_not_found(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    assert client.get("/users/by-email/nobody@example.com/").status_code == 404


# ---------------------------------------------------------------------------
# PATCH /users/{id}/ — admin only
# ---------------------------------------------------------------------------

def test_update_user_admin(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    created = _make_user(client)
    response = client.patch(f"/users/{created['id']}/", json={"phone": "555-1234"})
    assert response.status_code == 200
    assert response.json()["phone"] == "555-1234"


def test_update_user_admin_normalizes_us_phone(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    created = _make_user(client)
    response = client.patch(f"/users/{created['id']}/", json={"phone": "9495551234"})
    assert response.status_code == 200
    assert response.json()["phone"] == "(949) 555-1234"


def test_update_user_non_admin_forbidden(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.patch("/users/1/", json={"phone": "555-0000"}).status_code == 403


# ---------------------------------------------------------------------------
# DELETE /users/{id}/ — admin only
# ---------------------------------------------------------------------------

def test_delete_user_admin(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    created = _make_user(client)
    assert client.delete(f"/users/{created['id']}/").status_code == 204
    assert client.get(f"/users/{created['id']}/").status_code == 404


def test_delete_user_non_admin_forbidden(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.delete("/users/1/").status_code == 403


# ---------------------------------------------------------------------------
# GET /tournaments/{id}/users/{user_id}/ — manage_volunteers or manage_tournament
# ---------------------------------------------------------------------------

def test_get_tournament_user_td_can_access(
    client, admin_user, td_user, td_tournament, db
):
    login(client, "admin@test.com", "adminpass")
    alice = _make_user(client)
    db.add(Membership(
        user_id=alice["id"],
        tournament_id=td_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/users/{alice['id']}/")
    assert response.status_code == 200
    assert response.json()["email"] == "alice@example.com"


def test_get_tournament_user_volunteer_coordinator_can_access(
    client, admin_user, td_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["volunteer_coordinator"],
        status="confirmed",
    ))
    login(client, "admin@test.com", "adminpass")
    alice = _make_user(client)
    db.add(Membership(
        user_id=alice["id"],
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/users/{alice['id']}/"
    ).status_code == 200


def test_get_tournament_user_event_supervisor_forbidden(
    client, td_user, other_tournament, admin_user, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    login(client, "admin@test.com", "adminpass")
    alice = _make_user(client)
    db.add(Membership(
        user_id=alice["id"],
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/users/{alice['id']}/"
    ).status_code == 403


def test_get_tournament_user_not_member_of_tournament(
    client, admin_user, td_user, td_tournament, db
):
    login(client, "admin@test.com", "adminpass")
    alice = _make_user(client)
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{td_tournament.id}/users/{alice['id']}/"
    ).status_code == 404
