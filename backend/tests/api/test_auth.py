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
        status="deactivated",
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
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def invited_user(db):
    """An admin-created user who hasn't completed account-setup yet."""
    user = User(
        email="invited@test.com",
        first_name="Invited",
        last_name="User",
        role="user",
        status="invited",
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
            "password": VALID_PASSWORD,
        })
        assert res.status_code == 201
        data = res.json()
        assert data["email"] == "new@test.com"
        assert data["role"] == "user"
        assert data["status"] == "active"
        assert "hashed_password" not in data

    def test_register_sets_cookie(self, client):
        # Registration should log the user in immediately
        res = client.post("/auth/register/", json={
            "email": "new@test.com",
            "password": VALID_PASSWORD,
        })
        assert res.status_code == 201
        assert "access_token" in res.cookies

    def test_register_auto_login(self, client):
        # Cookie from registration should allow immediate access to /me/
        client.post("/auth/register/", json={
            "email": "new@test.com",
            "password": VALID_PASSWORD,
        })
        res = client.get("/users/me/")
        assert res.status_code == 200
        assert res.json()["email"] == "new@test.com"

    def test_register_email_stored_lowercase(self, client):
        res = client.post("/auth/register/", json={
            "email": "NEW@TEST.COM",
            "password": VALID_PASSWORD,
        })
        assert res.status_code == 201
        assert res.json()["email"] == "new@test.com"

    def test_register_duplicate_email_rejected(self, client, td_user):
        assert client.post("/auth/register/", json={
            "email": "td@test.com",
            "password": VALID_PASSWORD,
        }).status_code == 409

    def test_register_duplicate_email_case_insensitive_rejected(self, client, td_user):
        assert client.post("/auth/register/", json={
            "email": "TD@TEST.COM",
            "password": VALID_PASSWORD,
        }).status_code == 409

    def test_register_can_login_with_new_credentials(self, client):
        # Confirms the password was hashed and stored correctly
        client.post("/auth/register/", json={
            "email": "new@test.com",
            "password": VALID_PASSWORD,
        })
        client.post("/auth/logout/")
        assert login(client, "new@test.com", VALID_PASSWORD).status_code == 200

    def test_register_password_too_short(self, client):
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "password": "Ab@1",
        }).status_code == 422

    def test_register_password_missing_uppercase(self, client):
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "password": "secure@123",
        }).status_code == 422

    def test_register_password_missing_lowercase(self, client):
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "password": "SECURE@123",
        }).status_code == 422

    def test_register_password_missing_number(self, client):
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "password": "Secure@abc",
        }).status_code == 422

    def test_register_password_missing_symbol(self, client):
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "password": "Secure1234",
        }).status_code == 422

    def test_register_password_invalid_char(self, client):
        # Control characters (ASCII < 32) should be rejected
        assert client.post("/auth/register/", json={
            "email": "new@test.com", "password": "Secure@1\x01",
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
        # Accounts created by admin are "invited" until the user activates via email
        login(client, "admin@test.com", "adminpass")
        res = client.post("/admin/auth/register/", json={
            "email": "newuser@test.com",
            "first_name": "New",
            "last_name": "User",
            "role": "user",
        })
        assert res.status_code == 201
        assert res.json()["status"] == "invited"

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


# ---------------------------------------------------------------------------
# POST /auth/email/request-change/
# ---------------------------------------------------------------------------

class TestRequestEmailChange:
    def test_request_change_success(self, client, td_user, mock_send_email):
        login(client, "td@test.com", "tdpass")
        res = client.post("/auth/email/request-change/", json={"new_email": "tdnew@test.com"})
        assert res.status_code == 200
        assert mock_send_email.called

    def test_request_change_returns_pending_state(self, client, td_user, mock_send_email):
        login(client, "td@test.com", "tdpass")
        res = client.post("/auth/email/request-change/", json={"new_email": "tdnew@test.com"})
        body = res.json()
        assert body["new_email"] == "tdnew@test.com"
        assert body["can_resend_at"] is not None

    def test_duplicate_email_rejected(self, client, td_user, other_user):
        login(client, "td@test.com", "tdpass")
        res = client.post("/auth/email/request-change/", json={"new_email": "other@test.com"})
        assert res.status_code == 409

    def test_own_current_email_allowed(self, client, td_user):
        # Requesting a "change" to the same email isn't a conflict with self
        login(client, "td@test.com", "tdpass")
        res = client.post("/auth/email/request-change/", json={"new_email": "td@test.com"})
        assert res.status_code == 200

    def test_rate_limited_on_repeat_request(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        client.post("/auth/email/request-change/", json={"new_email": "tdnew@test.com"})
        res = client.post("/auth/email/request-change/", json={"new_email": "tdnew2@test.com"})
        assert res.status_code == 429

    def test_unauthenticated_forbidden(self, client):
        assert client.post("/auth/email/request-change/", json={"new_email": "x@test.com"}).status_code == 401


# ---------------------------------------------------------------------------
# GET /auth/email/pending-change/
# ---------------------------------------------------------------------------

class TestPendingEmailChange:
    def test_nothing_pending_returns_nulls(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.get("/auth/email/pending-change/")
        assert res.status_code == 200
        assert res.json() == {"new_email": None, "can_resend_at": None}

    def test_pending_change_reflects_request(self, client, td_user, mock_send_email):
        login(client, "td@test.com", "tdpass")
        client.post("/auth/email/request-change/", json={"new_email": "tdnew@test.com"})

        res = client.get("/auth/email/pending-change/")
        assert res.status_code == 200
        body = res.json()
        assert body["new_email"] == "tdnew@test.com"
        assert body["can_resend_at"] is not None

    def test_consumed_token_not_reported_as_pending(self, client, td_user, db):
        token = create_verification_token(db, td_user.id, "email_change", new_email="tdnew@test.com")
        client.get(f"/auth/email/confirm-change/?token={token}")

        login(client, "tdnew@test.com", "tdpass")
        res = client.get("/auth/email/pending-change/")
        assert res.json() == {"new_email": None, "can_resend_at": None}

    def test_unauthenticated_forbidden(self, client):
        assert client.get("/auth/email/pending-change/").status_code == 401


# ---------------------------------------------------------------------------
# GET /auth/email/confirm-change/
# ---------------------------------------------------------------------------

class TestConfirmEmailChange:
    def test_valid_token_confirms_change(self, client, td_user, db):
        token = create_verification_token(db, td_user.id, "email_change", new_email="tdnew@test.com")
        res = client.get(f"/auth/email/confirm-change/?token={token}")
        assert res.status_code == 200
        db.refresh(td_user)
        assert td_user.email == "tdnew@test.com"
        assert td_user.email_verified is True

    def test_invalid_token_rejected(self, client):
        assert client.get("/auth/email/confirm-change/?token=garbage").status_code == 400

    def test_token_already_used_rejected(self, client, td_user, db):
        token = create_verification_token(db, td_user.id, "email_change", new_email="tdnew@test.com")
        assert client.get(f"/auth/email/confirm-change/?token={token}").status_code == 200
        assert client.get(f"/auth/email/confirm-change/?token={token}").status_code == 400

    def test_wrong_purpose_token_rejected(self, client, td_user, db):
        # A signup_verify token shouldn't be usable here
        token = create_verification_token(db, td_user.id, "signup_verify")
        assert client.get(f"/auth/email/confirm-change/?token={token}").status_code == 400


# ---------------------------------------------------------------------------
# POST /auth/password/change/
# ---------------------------------------------------------------------------

class TestChangePassword:
    def test_change_password_success(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post("/auth/password/change/", json={
            "current_password": "tdpass",
            "new_password": VALID_PASSWORD,
        })
        assert res.status_code == 200
        client.post("/auth/logout/")
        assert login(client, "td@test.com", "tdpass").status_code == 401
        assert login(client, "td@test.com", VALID_PASSWORD).status_code == 200

    def test_wrong_current_password_rejected(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post("/auth/password/change/", json={
            "current_password": "wrongpass",
            "new_password": VALID_PASSWORD,
        })
        assert res.status_code == 401

    def test_new_password_same_as_current_rejected(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post("/auth/password/change/", json={
            "current_password": "tdpass",
            "new_password": "tdpass",
        })
        assert res.status_code == 422

    def test_weak_new_password_rejected(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.post("/auth/password/change/", json={
            "current_password": "tdpass",
            "new_password": "weak",
        })
        assert res.status_code == 422

    def test_unauthenticated_forbidden(self, client):
        res = client.post("/auth/password/change/", json={
            "current_password": "x",
            "new_password": VALID_PASSWORD,
        })
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# POST /auth/password/reset/request/
# ---------------------------------------------------------------------------

class TestRequestPasswordReset:
    def test_active_user_with_password_sends_email(self, client, td_user, mock_send_email):
        res = client.post("/auth/password/reset/request/", json={"email": "td@test.com"})
        assert res.status_code == 200
        assert mock_send_email.called

    def test_unknown_email_returns_generic_200_no_email_sent(self, client, mock_send_email):
        res = client.post("/auth/password/reset/request/", json={"email": "nobody@test.com"})
        assert res.status_code == 200
        assert not mock_send_email.called

    def test_invited_user_excluded_no_email_sent(self, client, invited_user, mock_send_email):
        # Pending admin-invited accounts have no password yet — they should
        # use account-setup, not password reset.
        res = client.post("/auth/password/reset/request/", json={"email": "invited@test.com"})
        assert res.status_code == 200
        assert not mock_send_email.called

    def test_no_password_user_excluded_no_email_sent(self, client, volunteer_no_password, mock_send_email):
        res = client.post("/auth/password/reset/request/", json={"email": "vol@test.com"})
        assert res.status_code == 200
        assert not mock_send_email.called

    def test_deactivated_user_excluded_no_email_sent(self, client, inactive_user, mock_send_email):
        res = client.post("/auth/password/reset/request/", json={"email": "inactive@test.com"})
        assert res.status_code == 200
        assert not mock_send_email.called

    def test_rate_limit_swallowed_as_generic_200(self, client, td_user):
        client.post("/auth/password/reset/request/", json={"email": "td@test.com"})
        res = client.post("/auth/password/reset/request/", json={"email": "td@test.com"})
        assert res.status_code == 200


# ---------------------------------------------------------------------------
# POST /auth/password/reset/confirm/
# ---------------------------------------------------------------------------

class TestConfirmPasswordReset:
    def test_valid_token_resets_password(self, client, td_user, db):
        token = create_verification_token(db, td_user.id, "password_reset")
        res = client.post("/auth/password/reset/confirm/", json={
            "token": token,
            "new_password": VALID_PASSWORD,
        })
        assert res.status_code == 200
        assert login(client, "td@test.com", "tdpass").status_code == 401
        assert login(client, "td@test.com", VALID_PASSWORD).status_code == 200

    def test_invalid_token_rejected(self, client):
        res = client.post("/auth/password/reset/confirm/", json={
            "token": "garbage",
            "new_password": VALID_PASSWORD,
        })
        assert res.status_code == 400

    def test_token_already_used_rejected(self, client, td_user, db):
        token = create_verification_token(db, td_user.id, "password_reset")
        client.post("/auth/password/reset/confirm/", json={"token": token, "new_password": VALID_PASSWORD})
        res = client.post("/auth/password/reset/confirm/", json={"token": token, "new_password": "Another@123"})
        assert res.status_code == 400

    def test_weak_new_password_rejected(self, client, td_user, db):
        token = create_verification_token(db, td_user.id, "password_reset")
        res = client.post("/auth/password/reset/confirm/", json={"token": token, "new_password": "weak"})
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# POST /auth/account-setup/confirm/
# ---------------------------------------------------------------------------

class TestConfirmAccountSetup:
    def test_valid_token_completes_setup(self, client, invited_user, db):
        token = create_verification_token(db, invited_user.id, "account_setup")
        res = client.post("/auth/account-setup/confirm/", json={
            "token": token,
            "password": VALID_PASSWORD,
        })
        assert res.status_code == 200
        assert "access_token" in res.cookies
        db.refresh(invited_user)
        assert invited_user.status == "active"
        assert invited_user.hashed_password is not None

    def test_confirm_logs_user_in(self, client, invited_user, db):
        token = create_verification_token(db, invited_user.id, "account_setup")
        client.post("/auth/account-setup/confirm/", json={
            "token": token,
            "password": VALID_PASSWORD,
        })
        assert client.get("/users/me/").status_code == 200

    def test_invalid_token_rejected(self, client):
        res = client.post("/auth/account-setup/confirm/", json={
            "token": "garbage",
            "password": VALID_PASSWORD,
        })
        assert res.status_code == 400


# ---------------------------------------------------------------------------
# POST /admin/auth/account-setup/resend/
# ---------------------------------------------------------------------------

class TestResendAccountSetup:
    def test_admin_can_resend_for_invited_user(self, client, admin_user, invited_user, mock_send_email):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/admin/auth/account-setup/resend/", json={"user_id": invited_user.id})
        assert res.status_code == 200
        assert mock_send_email.called

    def test_already_completed_rejected(self, client, admin_user, td_user):
        login(client, "admin@test.com", "adminpass")
        res = client.post("/admin/auth/account-setup/resend/", json={"user_id": td_user.id})
        assert res.status_code == 400

    def test_rate_limited_on_repeat_resend(self, client, admin_user, invited_user):
        login(client, "admin@test.com", "adminpass")
        client.post("/admin/auth/account-setup/resend/", json={"user_id": invited_user.id})
        res = client.post("/admin/auth/account-setup/resend/", json={"user_id": invited_user.id})
        assert res.status_code == 429

    def test_non_admin_forbidden(self, client, td_user, invited_user):
        login(client, "td@test.com", "tdpass")
        res = client.post("/admin/auth/account-setup/resend/", json={"user_id": invited_user.id})
        assert res.status_code == 403

    def test_unauthenticated_forbidden(self, client, invited_user):
        res = client.post("/admin/auth/account-setup/resend/", json={"user_id": invited_user.id})
        assert res.status_code == 401