"""Tests for /auth routes."""
import pytest
from fastapi.testclient import TestClient
from tests.conftest import login
from app.core.auth import hash_password, create_verification_token
from app.models.models import User


@pytest.fixture
def inactive_user(db):
    user = User(
        email="inactive@test.com",
        hashed_password=hash_password("pass"),
        first_name="Inactive",
        last_name="User",
        role="user",
        is_active=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def volunteer_no_password(db):
    user = User(
        email="vol@test.com",
        first_name="Volunteer",
        last_name="NoPassword",
        role="user",
        is_active=True,
    )
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
        assert client.get("/users/me/").status_code == 401

    def test_logout_without_session_still_succeeds(self, client):
        assert client.post("/auth/logout/").status_code == 200


# ---------------------------------------------------------------------------
# GET /users/me/ (default, no ?full) — slim shape, folded in from old /auth/me/
# ---------------------------------------------------------------------------

class TestMe:
    def test_me_returns_current_user(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.get("/users/me/")
        assert res.status_code == 200
        assert res.json()["email"] == "td@test.com"
        assert res.json()["role"] == "user"

    def test_me_unauthenticated(self, client):
        assert client.get("/users/me/").status_code == 401

    def test_me_admin_role(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        res = client.get("/users/me/")
        assert res.status_code == 200
        assert res.json()["role"] == "admin"


# ---------------------------------------------------------------------------
# POST /auth/register/   (public self-registration)
# ---------------------------------------------------------------------------

VALID_PASSWORD = "Secure@123"  # satisfies all validator rules
VALID_PHONE = "9495551234"


class TestRegister:
    def test_register_success(self, client):
        res = client.post("/auth/register/", json={
            "email": "new@test.com",
            "phone": VALID_PHONE,
            "password": VALID_PASSWORD,
            "first_name": "New",
            "last_name": "User",
        })
        assert res.status_code == 201
        data = res.json()
        assert data["email"] == "new@test.com"
        assert data["role"] == "user"
        assert data["is_active"] == True
        assert "hashed_password" not in data

    def test_register_sets_cookie(self, client):
        # Registration should log the user in immediately
        res = client.post("/auth/register/", json={
            "email": "new@test.com",
            "phone": VALID_PHONE,
            "password": VALID_PASSWORD,
            "first_name": "New",
            "last_name": "User",
        })
        assert res.status_code == 201
        assert "access_token" in res.cookies

    def test_register_auto_login(self, client):
        # Cookie from registration should allow immediate access to /me/
        client.post("/auth/register/", json={
            "email": "new@test.com",
            "phone": VALID_PHONE,
            "password": VALID_PASSWORD,
            "first_name": "New",
            "last_name": "User",
        })
        res = client.get("/users/me/")
        assert res.status_code == 200
        assert res.json()["email"] == "new@test.com"

    def test_register_email_stored_lowercase(self, client):
        res = client.post("/auth/register/", json={
            "email": "NEW@TEST.COM",
            "phone": VALID_PHONE,
            "password": VALID_PASSWORD,
            "first_name": "New",
            "last_name": "User",
        })
        assert res.status_code == 201
        assert res.json()["email"] == "new@test.com"

    def test_register_duplicate_email_rejected(self, client, td_user):
        assert client.post("/auth/register/", json={
            "email": "td@test.com",
            "phone": VALID_PHONE,
            "password": VALID_PASSWORD,
            "first_name": "New",
            "last_name": "User",
        }).status_code == 409

    def test_register_duplicate_email_case_insensitive_rejected(self, client, td_user):
        assert client.post("/auth/register/", json={
            "email": "TD@TEST.COM",
            "phone": VALID_PHONE,
            "password": VALID_PASSWORD,
            "first_name": "New",
            "last_name": "User",
        }).status_code == 409

    def test_register_invalid_phone_rejected(self, client):
        assert client.post("/auth/register/", json={
            "email": "new@test.com",
            "phone": "notaphone",
            "password": VALID_PASSWORD,
            "first_name": "New",
            "last_name": "User",
        }).status_code == 422

    def test_register_can_login_with_new_credentials(self, client):
        # Confirms the password was hashed and stored correctly
        client.post("/auth/register/", json={
            "email": "new@test.com",
            "phone": VALID_PHONE,
            "password": VALID_PASSWORD,
            "first_name": "New",
            "last_name": "User",
        })
        client.post("/auth/logout/")
        assert login(client, "new@test.com", VALID_PASSWORD).status_code == 200

    def test_register_password_too_short(self, client):
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "phone": VALID_PHONE, "password": "Ab@1",
            "first_name": "New", "last_name": "User",
        }).status_code == 422

    def test_register_password_missing_uppercase(self, client):
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "phone": VALID_PHONE, "password": "secure@123",
            "first_name": "New", "last_name": "User",
        }).status_code == 422

    def test_register_password_missing_lowercase(self, client):
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "phone": VALID_PHONE, "password": "SECURE@123",
            "first_name": "New", "last_name": "User",
        }).status_code == 422

    def test_register_password_missing_number(self, client):
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "phone": VALID_PHONE, "password": "Secure@abc",
            "first_name": "New", "last_name": "User",
        }).status_code == 422

    def test_register_password_missing_symbol(self, client):
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "phone": VALID_PHONE, "password": "Secure1234",
            "first_name": "New", "last_name": "User",
        }).status_code == 422

    def test_register_password_invalid_char(self, client):
        # Control characters (ASCII < 32) should be rejected
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "phone": VALID_PHONE, "password": "Secure@1\x01",
            "first_name": "New", "last_name": "User",
        }).status_code == 422


# ---------------------------------------------------------------------------
# POST /admin/auth/register/   (admin-only account creation)
# ---------------------------------------------------------------------------

class TestAdminRegister:
    def test_admin_can_create_user(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/admin/auth/register/", json={
            "email": "newuser@test.com",
            "first_name": "New",
            "last_name": "User",
            "role": "user",
        })
        assert res.status_code == 201
        data = res.json()
        assert data["email"] == "newuser@test.com"
        assert data["role"] == "user"

    def test_admin_can_create_admin(self, client, admin_user):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/admin/auth/register/", json={
            "email": "newadmin@test.com",
            "first_name": "New",
            "last_name": "Admin",
            "role": "admin",
        })
        assert res.status_code == 201
        assert res.json()["role"] == "admin"

    def test_admin_created_user_is_inactive(self, client, admin_user):
        # Accounts created by admin are inactive until the user activates via email
        login(client, "admin@test.com", "adminpass")
        res = client.post("/admin/auth/register/", json={
            "email": "newuser@test.com",
            "first_name": "New",
            "last_name": "User",
            "role": "user",
        })
        assert res.status_code == 201
        assert res.json()["is_active"] == False

    def test_admin_created_user_cannot_login(self, client, admin_user):
        # Inactive + no password — login must be blocked
        login(client, "admin@test.com", "adminpass")
        client.post("/admin/auth/register/", json={
            "email": "newuser@test.com",
            "first_name": "New",
            "last_name": "User",
            "role": "user",
        })
        client.post("/auth/logout/")
        assert login(client, "newuser@test.com", "anything").status_code == 401

    def test_non_admin_cannot_admin_register(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.post("/admin/auth/register/", json={
            "email": "new@test.com",
            "first_name": "New",
            "last_name": "User",
            "role": "user",
        }).status_code == 403

    def test_unauthenticated_cannot_admin_register(self, client):
        assert client.post("/admin/auth/register/", json={
            "email": "new@test.com",
            "first_name": "New",
            "last_name": "User",
            "role": "user",
        }).status_code == 401

    def test_admin_register_duplicate_email_rejected(self, client, admin_user, td_user):
        login(client, "admin@test.com", "adminpass")
        assert client.post("/admin/auth/register/", json={
            "email": "td@test.com",
            "first_name": "TD",
            "last_name": "User",
            "role": "user",
        }).status_code == 409

    def test_admin_register_invalid_role_rejected(self, client, admin_user):
        # Schema-level: only "admin" | "user" are valid roles
        login(client, "admin@test.com", "adminpass")
        assert client.post("/admin/auth/register/", json={
            "email": "new@test.com",
            "first_name": "New",
            "last_name": "User",
            "role": "superuser",
        }).status_code == 422


# ---------------------------------------------------------------------------
# GET /auth/verify-email/
# ---------------------------------------------------------------------------

class TestVerifyEmail:
    def test_valid_token_verifies_email(self, client, td_user, db):
        assert td_user.email_verified is False
        token = create_verification_token(db, td_user.id, "signup_verify")
        res = client.get(f"/auth/verify-email/?token={token}")
        assert res.status_code == 200
        db.refresh(td_user)
        assert td_user.email_verified is True

    def test_invalid_token_rejected(self, client):
        assert client.get("/auth/verify-email/?token=garbage").status_code == 400

    def test_token_already_used_rejected(self, client, td_user, db):
        token = create_verification_token(db, td_user.id, "signup_verify")
        assert client.get(f"/auth/verify-email/?token={token}").status_code == 200
        assert client.get(f"/auth/verify-email/?token={token}").status_code == 400


# ---------------------------------------------------------------------------
# POST /auth/send-email-verification/
# ---------------------------------------------------------------------------

class TestSendEmailVerification:
    def test_unverified_user_can_request(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.post("/auth/send-email-verification/").status_code == 200

    def test_already_verified_rejected(self, client, td_user, db):
        td_user.email_verified = True
        db.commit()
        login(client, "td@test.com", "tdpass")
        assert client.post("/auth/send-email-verification/").status_code == 400

    def test_unauthenticated_forbidden(self, client):
        assert client.post("/auth/send-email-verification/").status_code == 401