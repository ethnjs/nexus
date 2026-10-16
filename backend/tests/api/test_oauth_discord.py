"""Discord account linking. Discord's OAuth API is stubbed by `mock_discord_http`."""

from urllib.parse import parse_qs, urlparse

import pytest

from app.core.auth import create_session
from app.models.models import OAuthIdentity, OAuthProvider, User
from app.services.discord.oauth import DiscordOAuthError
from tests.conftest import login


@pytest.fixture
def volunteer_no_password(db):
    user = User(email="vol@test.com", first_name="Vol", last_name="Unteer", status="active")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _discord_api(user_id: str = "111", username: str = "tdhandle"):
    def fake(method, path, **kwargs):
        if path == "/oauth2/token":
            assert kwargs["data"]["code"] == "auth-code"
            return {"access_token": "user-token", "token_type": "Bearer"}
        if path == "/users/@me":
            assert kwargs["headers"]["Authorization"] == "Bearer user-token"
            return {"id": user_id, "username": username}
        raise AssertionError(path)

    return fake


def _start(client, **params):
    return client.get("/auth/oauth/discord/start/", params=params or None, follow_redirects=False)


def _state(start_response) -> str:
    return parse_qs(urlparse(start_response.headers["location"]).query)["state"][0]


def _callback(client, **params):
    return client.get("/auth/oauth/discord/callback/", params=params, follow_redirects=False)


def _link(client, mock_discord_http, **api):
    mock_discord_http.side_effect = _discord_api(**api)
    state = _state(_start(client))
    return _callback(client, code="auth-code", state=state)


def _add_identity(db, user, account_id="111", username="someone"):
    db.add(
        OAuthIdentity(
            user_id=user.id,
            provider=OAuthProvider.discord,
            provider_account_id=account_id,
            username_at_provider=username,
        )
    )
    db.commit()


class TestDiscordStart:
    def test_404_when_discord_is_off(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert _start(client).status_code == 404
        assert _callback(client, code="x", state="y").status_code == 404

    def test_signed_out_goes_to_sign_in_and_back(self, client, discord_on):
        res = _start(client)
        assert res.headers["location"] == (
            "http://localhost:3000/sign-in?redirect=%2Fconnect%2Fdiscord"
        )

    def test_redirects_to_discord_with_identify(self, client, discord_on, td_user):
        login(client, "td@test.com", "tdpass")
        res = _start(client)
        assert res.status_code == 302
        location = urlparse(res.headers["location"])
        assert f"{location.scheme}://{location.netloc}{location.path}" == (
            "https://discord.com/oauth2/authorize"
        )
        query = parse_qs(location.query)
        assert query["scope"] == ["identify"]
        assert query["client_id"] == ["1000"]
        assert query["response_type"] == ["code"]
        assert query["redirect_uri"] == [
            "http://localhost:3000/api/proxy/auth/oauth/discord/callback"
        ]
        assert query["state"][0]
        assert "oauth_state" in res.cookies

    def test_unconfigured_reports_unavailable(self, client, discord_on, td_user, monkeypatch):
        from app.core.config import get_settings

        monkeypatch.setattr(get_settings(), "discord_client_secret", "")
        login(client, "td@test.com", "tdpass")
        res = _start(client)
        assert res.headers["location"].endswith("/connect/discord?error=discord_unavailable")


class TestDiscordCallback:
    def test_links_and_returns_to_connect_page(
        self, client, db, discord_on, td_user, mock_discord_http
    ):
        login(client, "td@test.com", "tdpass")
        res = _link(client, mock_discord_http)
        assert res.headers["location"] == "http://localhost:3000/connect/discord?linked=discord"
        identity = db.query(OAuthIdentity).filter_by(user_id=td_user.id).one()
        assert identity.provider == OAuthProvider.discord
        assert identity.provider_account_id == "111"
        assert identity.username_at_provider == "tdhandle"
        assert identity.email_at_provider is None

    def test_returns_to_safe_redirect(self, client, db, discord_on, td_user, mock_discord_http):
        login(client, "td@test.com", "tdpass")
        mock_discord_http.side_effect = _discord_api()
        state = _state(_start(client, redirect="/settings/security"))
        res = _callback(client, code="auth-code", state=state)
        assert res.headers["location"].endswith("/settings/security?linked=discord")

    def test_unsafe_redirect_is_ignored(self, client, discord_on, td_user, mock_discord_http):
        login(client, "td@test.com", "tdpass")
        mock_discord_http.side_effect = _discord_api()
        state = _state(_start(client, redirect="https://evil.example/"))
        res = _callback(client, code="auth-code", state=state)
        assert res.headers["location"] == "http://localhost:3000/connect/discord?linked=discord"

    def test_account_linked_to_another_user_is_refused(
        self, client, db, discord_on, td_user, other_user, mock_discord_http
    ):
        _add_identity(db, other_user, account_id="111")
        login(client, "td@test.com", "tdpass")
        res = _link(client, mock_discord_http, user_id="111")
        assert res.headers["location"].endswith("/connect/discord?error=discord_already_linked")
        assert db.query(OAuthIdentity).filter_by(user_id=td_user.id).count() == 0
        assert db.query(OAuthIdentity).filter_by(user_id=other_user.id).count() == 1

    def test_second_discord_account_is_refused(
        self, client, db, discord_on, td_user, mock_discord_http
    ):
        _add_identity(db, td_user, account_id="first")
        login(client, "td@test.com", "tdpass")
        res = _link(client, mock_discord_http, user_id="second")
        assert res.headers["location"].endswith("/connect/discord?error=discord_link_exists")
        identity = db.query(OAuthIdentity).filter_by(user_id=td_user.id).one()
        assert identity.provider_account_id == "first"

    def test_relinking_the_same_account_succeeds(
        self, client, db, discord_on, td_user, mock_discord_http
    ):
        _add_identity(db, td_user, account_id="111", username="oldname")
        login(client, "td@test.com", "tdpass")
        res = _link(client, mock_discord_http, user_id="111", username="newname")
        assert res.headers["location"].endswith("/connect/discord?linked=discord")
        identity = db.query(OAuthIdentity).filter_by(user_id=td_user.id).one()
        assert identity.username_at_provider == "newname"

    def test_google_identity_does_not_block_discord(
        self, client, db, discord_on, td_user, mock_discord_http
    ):
        db.add(
            OAuthIdentity(
                user_id=td_user.id,
                provider=OAuthProvider.google,
                provider_account_id="111",
                email_at_provider="td@gmail.com",
            )
        )
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = _link(client, mock_discord_http, user_id="111")
        assert res.headers["location"].endswith("?linked=discord")
        assert db.query(OAuthIdentity).filter_by(user_id=td_user.id).count() == 2

    def test_state_mismatch(self, client, db, discord_on, td_user, mock_discord_http):
        login(client, "td@test.com", "tdpass")
        _start(client)
        res = _callback(client, code="auth-code", state="forged")
        assert res.headers["location"].endswith("/connect/discord?error=discord_failed")
        assert mock_discord_http.call_count == 0
        assert db.query(OAuthIdentity).count() == 0

    def test_callback_without_start(self, client, db, discord_on, td_user, mock_discord_http):
        login(client, "td@test.com", "tdpass")
        res = _callback(client, code="auth-code", state="anything")
        assert res.headers["location"].endswith("/connect/discord?error=discord_failed")
        assert mock_discord_http.call_count == 0

    def test_cancelled_on_discord(self, client, discord_on, td_user):
        login(client, "td@test.com", "tdpass")
        state = _state(_start(client))
        res = _callback(client, error="access_denied", state=state)
        assert res.headers["location"].endswith("/connect/discord?error=discord_cancelled")

    def test_token_exchange_failure(self, client, db, discord_on, td_user, mock_discord_http):
        login(client, "td@test.com", "tdpass")
        state = _state(_start(client))
        mock_discord_http.side_effect = DiscordOAuthError("POST /oauth2/token failed")
        res = _callback(client, code="auth-code", state=state)
        assert res.headers["location"].endswith("/connect/discord?error=discord_failed")
        assert db.query(OAuthIdentity).count() == 0

    def test_session_changed_between_start_and_callback(
        self, client, db, discord_on, td_user, other_user, mock_discord_http
    ):
        login(client, "td@test.com", "tdpass")
        state = _state(_start(client))
        login(client, "other@test.com", "otherpass")
        mock_discord_http.side_effect = _discord_api()
        res = _callback(client, code="auth-code", state=state)
        assert res.headers["location"].endswith("?error=discord_failed")
        assert db.query(OAuthIdentity).count() == 0


class TestDiscordIdentities:
    def test_listed_with_username(self, client, db, td_user):
        _add_identity(db, td_user, username="tdhandle")
        login(client, "td@test.com", "tdpass")
        body = client.get("/users/me/identities/").json()
        assert body == [
            {
                "provider": "discord",
                "email_at_provider": None,
                "username_at_provider": "tdhandle",
                "created_at": body[0]["created_at"],
            }
        ]

    def test_unlink_needs_no_password(self, client, db, volunteer_no_password, mock_send_email):
        _add_identity(db, volunteer_no_password)
        client.cookies.set("access_token", create_session(db, volunteer_no_password.id))
        res = client.delete("/users/me/identities/discord/")
        assert res.status_code == 200
        assert db.query(OAuthIdentity).count() == 0
        assert mock_send_email.await_count == 0

    def test_unlink_leaves_google(self, client, db, td_user):
        _add_identity(db, td_user)
        db.add(
            OAuthIdentity(
                user_id=td_user.id, provider=OAuthProvider.google, provider_account_id="g"
            )
        )
        db.commit()
        login(client, "td@test.com", "tdpass")
        assert client.delete("/users/me/identities/discord/").status_code == 200
        remaining = db.query(OAuthIdentity).filter_by(user_id=td_user.id).one()
        assert remaining.provider == OAuthProvider.google

    def test_unlink_when_not_connected(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        assert client.delete("/users/me/identities/discord/").status_code == 400

    def test_unlink_requires_sign_in(self, client):
        assert client.delete("/users/me/identities/discord/").status_code == 401
