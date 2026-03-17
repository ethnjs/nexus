"""Tests for user routes."""

import pytest
from fastapi.testclient import TestClient
from tests.conftest import login


def _make_user(client: TestClient, email: str = "alice@example.com", **overrides) -> dict:
    payload = {
        "first_name": "Alice",
        "last_name": "Smith",
        "email": email,
        "phone": "555-1234",
        "shirt_size": "M",
        "dietary_restriction": None,
    }
    payload.update(overrides)
    return client.post("/users/", json=payload)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def test_create_user(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = _make_user(client)
    assert response.status_code == 201
    data = response.json()
    assert data["first_name"] == "Alice"
    assert data["last_name"] == "Smith"
    assert data["email"] == "alice@example.com"
    assert "id" in data


def test_create_user_email_normalized(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = _make_user(client, email="  ALICE@EXAMPLE.COM  ")
    assert response.status_code == 201
    assert response.json()["email"] == "alice@example.com"


def test_create_user_invalid_email(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = _make_user(client, email="not-an-email")
    assert response.status_code == 422


def test_create_user_duplicate_email(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    _make_user(client)
    response = _make_user(client)  # same email
    assert response.status_code == 409


def test_create_user_minimal(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post("/users/", json={
        "first_name": "Bob",
        "last_name": "Jones",
        "email": "bob@example.com",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["phone"] is None
    assert data["shirt_size"] is None
    assert data["university"] is None
    assert data["major"] is None
    assert data["employer"] is None


def test_create_user_with_profile(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post("/users/", json={
        "first_name": "Carol",
        "last_name": "Chen",
        "email": "carol@example.com",
        "university": "USC",
        "major": "Computer Science",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["university"] == "USC"
    assert data["major"] == "Computer Science"
    assert data["employer"] is None


# ---------------------------------------------------------------------------
# Get
# ---------------------------------------------------------------------------

def test_get_user(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = _make_user(client).json()
    response = client.get(f"/users/{created['id']}/")
    assert response.status_code == 200
    assert response.json()["email"] == "alice@example.com"


def test_get_user_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/users/9999/").status_code == 404


def test_get_user_by_email(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    _make_user(client)
    response = client.get("/users/by-email/alice@example.com/")
    assert response.status_code == 200
    assert response.json()["first_name"] == "Alice"


def test_get_user_by_email_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/users/by-email/nobody@example.com/").status_code == 404


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def test_list_users(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    _make_user(client, email="alice@example.com", last_name="Smith")
    _make_user(client, email="bob@example.com", last_name="Adams")
    response = client.get("/users/")
    assert response.status_code == 200
    users = response.json()
    volunteer_users = [u for u in users if u["email"] not in ("td@test.com",)]
    assert len(volunteer_users) == 2
    assert volunteer_users[0]["last_name"] == "Adams"
    assert volunteer_users[1]["last_name"] == "Smith"


def test_list_users_empty(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.get("/users/")
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_update_user(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = _make_user(client).json()
    response = client.patch(f"/users/{created['id']}/", json={
        "shirt_size": "L",
        "phone": "555-9999",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["shirt_size"] == "L"
    assert data["phone"] == "555-9999"
    assert data["first_name"] == "Alice"  # unchanged


def test_update_user_university(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = _make_user(client).json()
    response = client.patch(f"/users/{created['id']}/", json={
        "university": "UCLA",
        "major": "Biology",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["university"] == "UCLA"
    assert data["major"] == "Biology"
    assert data["first_name"] == "Alice"  # unchanged


def test_update_user_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.patch("/users/9999/", json={"shirt_size": "L"}).status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_user(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    created = _make_user(client).json()
    assert client.delete(f"/users/{created['id']}/").status_code == 204
    assert client.get(f"/users/{created['id']}/").status_code == 404


def test_delete_user_not_found(client: TestClient, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.delete("/users/9999/").status_code == 404