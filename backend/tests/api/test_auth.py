"""
Tests for /api/v1/auth routes.

Covers: login, logout, /me, /register
"""
import pytest
from fastapi.testclient import TestClient
from tests.conftest import login

from app.core.auth import hash_password
from app.models.models import User


# ---------------------------------------------------------------------------
# Extra fixtures local to auth tests
# ---------------------------------------------------------------------------

@pytest.fixture
def inactive_user(db):
    user = User(
        email="inactive@test.com",
        hashed_password=hash_password("pass"),
        role="td",
        is_active=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def volunteer_no_password(db):
    """Volunteer synced from sheet — has no password set."""
    user = User(email="vol@test.com", role="volunteer", is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# POST /auth/login
# ---------------------------------------------------------------------------

class TestLogin:
    def test_login_success_sets_cookie(self, client, td_user):
        res = login(client, "td@test.com", "tdpass")
        assert res.status_code == 200
        assert "access_token" in res.cookies
        data = res.json()
        assert data["email"] == "td@test.com"
        assert data["role"] == "td"
        assert "hashed_password" not in data

    def test_login_wrong_password(self, client, td_user):
        res = login(client, "td@test.com", "wrongpass")
        assert res.status_code == 401

    def test_login_wrong_email(self, client):
        res = login(client, "nobody@test.com", "pass")
        assert res.status_code == 401

    def test_login_inactive_user(self, client, inactive_user):
        res = login(client, "inactive@test.com", "pass")
        assert res.status_code == 401

    def test_login_no_password_set(self, client, volunteer_no_password):
        res = login(client, "vol@test.com", "anything")
        assert res.status_code == 401

    def test_login_case_insensitive_email(self, client, td_user):
        res = login(client, "TD@TEST.COM", "tdpass")
        assert res.status_code == 200


# ---------------------------------------------------------------------------
# POST /auth/logout
# ---------------------------------------------------------------------------

class TestLogout:
    def test_logout_clears_cookie(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post("/api/v1/auth/logout")
        assert res.status_code == 200
        assert res.cookies.get("access_token", "") == ""

    def test_cannot_access_me_after_logout(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.post("/api/v1/auth/logout")
        res = client.get("/api/v1/auth/me")
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# GET /auth/me
# ---------------------------------------------------------------------------

class TestMe:
    def test_me_returns_current_user(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.get("/api/v1/auth/me")
        assert res.status_code == 200
        assert res.json()["email"] == "td@test.com"

    def test_me_unauthenticated(self, client):
        res = client.get("/api/v1/auth/me")
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# POST /auth/register
# ---------------------------------------------------------------------------

class TestRegister:
    def test_admin_can_register_td(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/api/v1/auth/register", json={
            "email": "newtd@test.com",
            "password": "newpass123",
            "first_name": "New",
            "last_name": "TD",
            "role": "td",
        })
        assert res.status_code == 201
        assert res.json()["role"] == "td"
        assert res.json()["email"] == "newtd@test.com"

    def test_td_cannot_register_others(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post("/api/v1/auth/register", json={
            "email": "another@test.com",
            "password": "pass",
            "role": "td",
        })
        assert res.status_code == 403

    def test_unauthenticated_cannot_register(self, client):
        res = client.post("/api/v1/auth/register", json={
            "email": "new@test.com",
            "password": "pass",
            "role": "td",
        })
        assert res.status_code == 401

    def test_duplicate_email_rejected(self, client, admin_user, td_user):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/api/v1/auth/register", json={
            "email": "td@test.com",  # already exists
            "password": "pass",
            "role": "td",
        })
        assert res.status_code == 409

    def test_invalid_role_rejected(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/api/v1/auth/register", json={
            "email": "new@test.com",
            "password": "pass",
            "role": "superuser",  # invalid
        })
        assert res.status_code == 422

    def test_registered_user_can_login(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        client.post("/api/v1/auth/register", json={
            "email": "brand@new.com",
            "password": "securepass",
            "role": "td",
        })
        # Log out admin, log in as new TD
        client.post("/api/v1/auth/logout")
        res = login(client, "brand@new.com", "securepass")
        assert res.status_code == 200
        assert res.json()["role"] == "td"