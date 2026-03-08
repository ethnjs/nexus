"""Tests for /api/v1/users endpoints."""

import pytest
from fastapi.testclient import TestClient


def _make_user(client: TestClient, **overrides) -> dict:
    payload = {
        "first_name": "Alice",
        "last_name": "Smith",
        "email": "alice@example.com",
        "phone": "555-1234",
        "shirt_size": "M",
        "dietary_restriction": None,
    }
    payload.update(overrides)
    return client.post("/api/v1/users/", json=payload)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def test_create_user(client: TestClient):
    response = _make_user(client)
    assert response.status_code == 201
    data = response.json()
    assert data["first_name"] == "Alice"
    assert data["last_name"] == "Smith"
    assert data["email"] == "alice@example.com"
    assert "id" in data


def test_create_user_email_normalized(client: TestClient):
    """Email should be lowercased and trimmed."""
    response = _make_user(client, email="  ALICE@EXAMPLE.COM  ")
    assert response.status_code == 201
    assert response.json()["email"] == "alice@example.com"


def test_create_user_invalid_email(client: TestClient):
    response = _make_user(client, email="not-an-email")
    assert response.status_code == 422


def test_create_user_duplicate_email(client: TestClient):
    _make_user(client)
    response = _make_user(client)  # same email
    assert response.status_code == 409


def test_create_user_minimal(client: TestClient):
    """Only required fields."""
    response = client.post("/api/v1/users/", json={
        "first_name": "Bob",
        "last_name": "Jones",
        "email": "bob@example.com",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["phone"] is None
    assert data["shirt_size"] is None


# ---------------------------------------------------------------------------
# Get
# ---------------------------------------------------------------------------

def test_get_user(client: TestClient):
    created = _make_user(client).json()
    response = client.get(f"/api/v1/users/{created['id']}")
    assert response.status_code == 200
    assert response.json()["email"] == "alice@example.com"


def test_get_user_not_found(client: TestClient):
    assert client.get("/api/v1/users/9999").status_code == 404


def test_get_user_by_email(client: TestClient):
    _make_user(client)
    response = client.get("/api/v1/users/by-email/alice@example.com")
    assert response.status_code == 200
    assert response.json()["first_name"] == "Alice"


def test_get_user_by_email_not_found(client: TestClient):
    assert client.get("/api/v1/users/by-email/nobody@example.com").status_code == 404


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def test_list_users(client: TestClient):
    _make_user(client, email="alice@example.com", last_name="Smith")
    _make_user(client, email="bob@example.com", last_name="Adams")
    response = client.get("/api/v1/users/")
    assert response.status_code == 200
    users = response.json()
    assert len(users) == 2
    # Should be ordered by last_name then first_name
    assert users[0]["last_name"] == "Adams"
    assert users[1]["last_name"] == "Smith"


def test_list_users_empty(client: TestClient):
    assert client.get("/api/v1/users/").json() == []


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_update_user(client: TestClient):
    created = _make_user(client).json()
    response = client.patch(f"/api/v1/users/{created['id']}", json={
        "shirt_size": "L",
        "phone": "555-9999",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["shirt_size"] == "L"
    assert data["phone"] == "555-9999"
    assert data["first_name"] == "Alice"  # unchanged


def test_update_user_not_found(client: TestClient):
    assert client.patch("/api/v1/users/9999", json={"shirt_size": "L"}).status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_user(client: TestClient):
    created = _make_user(client).json()
    assert client.delete(f"/api/v1/users/{created['id']}").status_code == 204
    assert client.get(f"/api/v1/users/{created['id']}").status_code == 404


def test_delete_user_not_found(client: TestClient):
    assert client.delete("/api/v1/users/9999").status_code == 404