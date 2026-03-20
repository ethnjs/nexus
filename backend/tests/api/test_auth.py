"""Tests for /auth routes."""
import pytest
from fastapi.testclient import TestClient
from tests.conftest import login
from app.core.auth import hash_password
from app.models.models import User


@pytest.fixture
def inactive_user(db):
    user = User(
        email="inactive@test.com",
        hashed_password=hash_password("pass"),
        role="user",
        is_active=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def volunteer_no_password(db):
    user = User(email="vol@test.com", role="user", is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# POST /auth/login/
# ---------------------------------------------------------------------------

class TestLogin:
    def test_login_success_sets_cookie(self, client, td_user):
        res = login(client, "td@test.com", "tdpass")
        assert res.status_code == 200
        assert "access_token" in res.cookies
        data = res.json()
        assert data["email"] == "td@test.com"
        assert data["role"] == "user"
        assert "hashed_password" not in data

    def test_login_wrong_password(self, client, td_user):
        assert login(client, "td@test.com", "wrongpass").status_code == 401

    def test_login_wrong_email(self, client):
        assert login(client, "nobody@test.com", "pass").status_code == 401

    def test_login_inactive_user(self, client, inactive_user):
        assert login(client, "inactive@test.com", "pass").status_code == 401

    def test_login_no_password_set(self, client, volunteer_no_password):
        assert login(client, "vol@test.com", "anything").status_code == 401

    def test_login_case_insensitive_email(self, client, td_user):
        assert login(client, "TD@TEST.COM", "tdpass").status_code == 200

    def test_admin_login_returns_admin_role(self, client, admin_user):
        res = login(client, "admin@test.com", "adminpass")
        assert res.status_code == 200
        assert res.json()["role"] == "admin"


# ---------------------------------------------------------------------------
# POST /auth/logout/
# ---------------------------------------------------------------------------

class TestLogout:
    def test_logout_clears_cookie(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post("/auth/logout/")
        assert res.status_code == 200
        assert res.cookies.get("access_token", "") == ""

    def test_cannot_access_me_after_logout(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.post("/auth/logout/")
        assert client.get("/auth/me/").status_code == 401


# ---------------------------------------------------------------------------
# GET /auth/me/
# ---------------------------------------------------------------------------

class TestMe:
    def test_me_returns_current_user(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.get("/auth/me/")
        assert res.status_code == 200
        assert res.json()["email"] == "td@test.com"
        assert res.json()["role"] == "user"

    def test_me_unauthenticated(self, client):
        assert client.get("/auth/me/").status_code == 401

    def test_me_admin_role(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        res = client.get("/auth/me/")
        assert res.status_code == 200
        assert res.json()["role"] == "admin"


# ---------------------------------------------------------------------------
# POST /auth/register/
# ---------------------------------------------------------------------------

class TestRegister:
    def test_admin_can_register_user(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/auth/register/", json={
            "email": "newuser@test.com",
            "password": "newpass123",
            "first_name": "New",
            "last_name": "User",
        })
        assert res.status_code == 201
        assert res.json()["role"] == "user"
        assert res.json()["email"] == "newuser@test.com"

    def test_registered_user_role_is_always_user(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/auth/register/", json={
            "email": "another@test.com",
            "password": "pass",
        })
        assert res.status_code == 201
        assert res.json()["role"] == "user"

    def test_non_admin_cannot_register(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post("/auth/register/", json={
            "email": "another@test.com",
            "password": "pass",
        })
        assert res.status_code == 403

    def test_unauthenticated_cannot_register(self, client):
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "password": "pass",
        }).status_code == 401

    def test_duplicate_email_rejected(self, client, admin_user, td_user):
        login(client, "admin@test.com", "adminpass")
        assert client.post("/auth/register/", json={
            "email": "td@test.com", "password": "pass",
        }).status_code == 409

    def test_registered_user_can_login(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        client.post("/auth/register/", json={
            "email": "brand@new.com", "password": "securepass",
        })
        client.post("/auth/logout/")
        res = login(client, "brand@new.com", "securepass")
        assert res.status_code == 200
        assert res.json()["role"] == "user"