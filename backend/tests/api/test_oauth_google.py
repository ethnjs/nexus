"""Google OIDC start/callback. No network: metadata and token exchange are stubbed."""

import time
from datetime import date
from urllib.parse import parse_qs, urlparse

import pytest
from authlib.integrations.base_client import OAuthError
from authlib.integrations.starlette_client.apps import StarletteOAuth2App

from app.core.auth import create_session
from app.models.models import OAuthIdentity, OAuthProvider, User
from tests.conftest import login


@pytest.fixture
def volunteer_no_password(db):
    user = User(email="vol@test.com", first_name="Volunteer", last_name="NoPassword", role="user", status="active")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _complete_profile(db, user: User) -> None:
    user.phone = "5551234567"
    user.date_of_birth = date(1990, 1, 1)
    user.shirt_size = "M"
    user.dietary_restriction = "None"
    user.student_status = "Non-Student"
    user.employer = "Acme"
    user.has_competition_experience = False
    user.has_volunteer_experience = False
    db.commit()


@pytest.fixture
def google_settings(monkeypatch):
    from app.core import oauth as oauth_mod
    from app.core.config import get_settings

    oauth_mod._oauth = None
    settings = get_settings()
    monkeypatch.setattr(settings, "google_oauth_client_id", "test-client")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "test-secret")
    monkeypatch.setattr(settings, "google_oauth_redirect_uri", "http://localhost:8001/auth/oauth/google/callback/")
    monkeypatch.setattr(settings, "frontend_url", "http://localhost:3000/")

    async def fake_load(self):
        self.server_metadata.update({
            "issuer": "https://accounts.google.com",
            "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_endpoint": "https://oauth2.googleapis.com/token",
            "_loaded_at": time.time(),
        })
        return self.server_metadata

    monkeypatch.setattr(
        "authlib.integrations.base_client.async_app.AsyncOAuth2Mixin.load_server_metadata",
        fake_load,
    )
    yield
    oauth_mod._oauth = None


def _start(client, **params):
    return client.get("/auth/oauth/google/start/", params=params or None, follow_redirects=False)


def _callback(client, monkeypatch, userinfo=None, error=None):
    async def fake(self, request, **kwargs):
        if error is not None:
            raise error
        return {"userinfo": userinfo or {}}

    monkeypatch.setattr(StarletteOAuth2App, "authorize_access_token", fake)
    return client.get(
        "/auth/oauth/google/callback/",
        params={"code": "auth-code", "state": "state"},
        follow_redirects=False,
    )


def _location(res) -> str:
    return res.headers["location"]


class TestGoogleStart:
    def test_redirects_to_google_with_pkce(self, client, google_settings):
        res = _start(client, intent="login", redirect="/dashboard")
        assert res.status_code == 302
        location = _location(res)
        assert location.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
        query = parse_qs(urlparse(location).query)
        assert query["code_challenge_method"] == ["S256"]
        assert query["prompt"] == ["select_account"]
        assert "code_challenge" in query
        assert "oauth_state" in res.cookies

    def test_unconfigured_redirects(self, client, monkeypatch):
        from app.core.config import get_settings
        settings = get_settings()
        monkeypatch.setattr(settings, "google_oauth_client_id", "")
        monkeypatch.setattr(settings, "google_oauth_client_secret", "")
        monkeypatch.setattr(settings, "google_oauth_redirect_uri", "")
        monkeypatch.setattr(settings, "frontend_url", "http://localhost:3000/")
        res = _start(client)
        assert res.status_code == 302
        assert _location(res).endswith("/sign-in?error=google_unavailable")

    def test_link_without_session_goes_to_sign_in(self, client, google_settings):
        res = _start(client, intent="link")
        assert _location(res).endswith("/sign-in?redirect=/settings/security")


class TestGoogleCallback:
    def test_new_user_is_created_and_sent_to_onboarding(self, client, db, google_settings, monkeypatch):
        _start(client, redirect="/join")
        res = _callback(client, monkeypatch, {
            "sub": "google-sub-1",
            "email": "Ada@Example.com",
            "email_verified": True,
            "given_name": "Ada",
            "family_name": "Lovelace",
        })
        assert res.status_code == 302
        assert _location(res).startswith("http://localhost:3000/onboarding?")
        assert "redirect=%2Fjoin" in _location(res)
        assert "access_token" in res.cookies

        user = db.query(User).filter(User.email == "ada@example.com").one()
        assert user.email_verified is True
        assert user.hashed_password is None
        assert user.first_name == "Ada"
        assert user.last_name == "Lovelace"
        identity = db.query(OAuthIdentity).filter_by(user_id=user.id).one()
        assert identity.provider == OAuthProvider.google
        assert identity.provider_account_id == "google-sub-1"
        assert "oauth_state" in res.headers.get("set-cookie", "")

    def test_unverified_google_email(self, client, db, google_settings, monkeypatch):
        _start(client)
        _callback(client, monkeypatch, {
            "sub": "google-sub-2",
            "email": "unverified@example.com",
            "email_verified": False,
            "given_name": "No",
            "family_name": "Verify",
        })
        user = db.query(User).filter(User.email == "unverified@example.com").one()
        assert user.email_verified is False

    def test_returning_user_signs_in(self, client, db, td_user, google_settings, monkeypatch):
        _complete_profile(db, td_user)
        db.add(OAuthIdentity(
            user_id=td_user.id,
            provider=OAuthProvider.google,
            provider_account_id="td-sub",
            email_at_provider="td@test.com",
        ))
        db.commit()
        _start(client)
        res = _callback(client, monkeypatch, {
            "sub": "td-sub",
            "email": "td@test.com",
            "email_verified": True,
        })
        assert _location(res) == "http://localhost:3000/dashboard"
        assert db.query(User).filter(User.email == "td@test.com").count() == 1

    def test_existing_email_is_not_auto_linked(self, client, db, td_user, google_settings, monkeypatch):
        before = db.query(User).count()
        _start(client)
        res = _callback(client, monkeypatch, {
            "sub": "someone-else",
            "email": "td@test.com",
            "email_verified": True,
        })
        assert _location(res).endswith("/sign-in?error=google_account_exists")
        assert db.query(User).count() == before
        assert db.query(OAuthIdentity).count() == 0

    def test_inactive_user_rejected(self, client, db, google_settings, monkeypatch):
        user = User(
            email="gone@test.com",
            first_name="Gone",
            last_name="User",
            role="user",
            status="deactivated",
        )
        db.add(user)
        db.flush()
        db.add(OAuthIdentity(
            user_id=user.id,
            provider=OAuthProvider.google,
            provider_account_id="gone-sub",
            email_at_provider="gone@test.com",
        ))
        db.commit()
        _start(client)
        res = _callback(client, monkeypatch, {
            "sub": "gone-sub",
            "email": "gone@test.com",
            "email_verified": True,
        })
        assert _location(res).endswith("/sign-in?error=google_account_inactive")

    def test_provider_cancel(self, client, google_settings):
        _start(client)
        res = client.get(
            "/auth/oauth/google/callback/",
            params={"error": "access_denied"},
            follow_redirects=False,
        )
        assert _location(res).endswith("/sign-in?error=google_cancelled")

    def test_state_mismatch(self, client, google_settings, monkeypatch):
        _start(client)
        res = _callback(client, monkeypatch, error=OAuthError(error="mismatching_state"))
        assert _location(res).endswith("/sign-in?error=google_failed")

    def test_unsafe_redirect_is_ignored(self, client, google_settings, monkeypatch):
        _start(client, redirect="https://evil.example/phish")
        res = _callback(client, monkeypatch, {
            "sub": "new-sub",
            "email": "new@example.com",
            "email_verified": True,
            "given_name": "New",
            "family_name": "User",
        })
        assert "evil.example" not in _location(res)
        assert _location(res) == "http://localhost:3000/onboarding"


class TestGoogleLink:
    def test_links_a_different_email(self, client, db, td_user, google_settings, monkeypatch, mock_send_email):
        login(client, "td@test.com", "tdpass")
        _start(client, intent="link")
        res = _callback(client, monkeypatch, {
            "sub": "personal-sub",
            "email": "personal@gmail.com",
            "email_verified": True,
        })
        assert _location(res).endswith("/settings/security?linked=google")
        db.refresh(td_user)
        assert td_user.email == "td@test.com"
        identity = db.query(OAuthIdentity).filter_by(user_id=td_user.id).one()
        assert identity.email_at_provider == "personal@gmail.com"
        assert mock_send_email.await_count == 1

    def test_sub_already_linked_elsewhere(self, client, db, td_user, other_user, google_settings, monkeypatch):
        db.add(OAuthIdentity(
            user_id=other_user.id,
            provider=OAuthProvider.google,
            provider_account_id="taken-sub",
            email_at_provider="other@test.com",
        ))
        db.commit()
        login(client, "td@test.com", "tdpass")
        _start(client, intent="link")
        res = _callback(client, monkeypatch, {
            "sub": "taken-sub",
            "email": "other@test.com",
            "email_verified": True,
        })
        assert _location(res).endswith("/settings/security?error=google_already_linked")

    def test_second_google_link_rejected(self, client, db, td_user, google_settings, monkeypatch):
        db.add(OAuthIdentity(
            user_id=td_user.id,
            provider=OAuthProvider.google,
            provider_account_id="first-sub",
            email_at_provider="td@test.com",
        ))
        db.commit()
        login(client, "td@test.com", "tdpass")
        _start(client, intent="link")
        res = _callback(client, monkeypatch, {
            "sub": "second-sub",
            "email": "second@gmail.com",
            "email_verified": True,
        })
        assert _location(res).endswith("/settings/security?error=google_link_exists")

    def test_session_changed_between_start_and_callback(self, client, db, td_user, other_user, google_settings, monkeypatch):
        login(client, "td@test.com", "tdpass")
        _start(client, intent="link")
        login(client, "other@test.com", "otherpass")
        res = _callback(client, monkeypatch, {
            "sub": "hijack-sub",
            "email": "hijack@gmail.com",
            "email_verified": True,
        })
        assert _location(res).endswith("/settings/security?error=google_failed")
        assert db.query(OAuthIdentity).count() == 0


class TestIdentities:
    def test_list_and_unlink(self, client, db, td_user, mock_send_email):
        login(client, "td@test.com", "tdpass")
        db.add(OAuthIdentity(
            user_id=td_user.id,
            provider=OAuthProvider.google,
            provider_account_id="list-sub",
            email_at_provider="td@gmail.com",
        ))
        db.commit()

        listed = client.get("/users/me/identities/")
        assert listed.status_code == 200
        body = listed.json()
        assert body[0]["provider"] == "google"
        assert body[0]["email_at_provider"] == "td@gmail.com"
        assert "created_at" in body[0]

        res = client.delete("/users/me/identities/google/")
        assert res.status_code == 200
        assert db.query(OAuthIdentity).count() == 0
        assert mock_send_email.await_count == 1

    def test_unlink_blocked_without_password(self, client, db, volunteer_no_password):
        token = create_session(db, volunteer_no_password.id)
        client.cookies.set("access_token", token)
        db.add(OAuthIdentity(
            user_id=volunteer_no_password.id,
            provider=OAuthProvider.google,
            provider_account_id="only-sub",
            email_at_provider="vol@test.com",
        ))
        db.commit()
        res = client.delete("/users/me/identities/google/")
        assert res.status_code == 400
        assert db.query(OAuthIdentity).count() == 1
