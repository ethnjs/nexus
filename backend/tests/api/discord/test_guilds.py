"""Linking Discord servers to tracks. Discord's OAuth API is stubbed by `mock_discord_http`, and
the leave notification is recorded instead of sent, since the test transaction never commits."""

from urllib.parse import parse_qs, urlparse

import pytest

from app.core.tournament.audit import (
    DISCORD_SERVER_LINKED,
    DISCORD_SERVER_UNLINKED,
    DISCORD_SETTINGS_UPDATED,
)
from app.models.discord import DiscordGuildLink
from app.models.models import (
    AuditLogEntry,
    OAuthIdentity,
    OAuthProvider,
    TournamentTrack,
    User,
    utcnow,
)
from tests.conftest import grant_role, login, primary_track_id

GUILD_ID = 1_560_569_782_195_978_320
TD_DISCORD = "4001"


@pytest.fixture
def left(monkeypatch, mock_discord_rest) -> list[int]:
    """Guild ids the bot left, or that the routes asked the leader to leave."""
    monkeypatch.setattr(
        "app.api.routes.discord.guilds.notify_leave",
        lambda db, guild_id: mock_discord_rest.left.append(guild_id),
    )
    return mock_discord_rest.left


@pytest.fixture
def track_id(db, td_tournament) -> int:
    return primary_track_id(db, td_tournament.id)


def _link_discord(db, user: User, account_id: str) -> None:
    db.add(
        OAuthIdentity(
            user_id=user.id, provider=OAuthProvider.discord, provider_account_id=account_id
        )
    )
    db.commit()


def _make_user(db, email: str) -> User:
    from app.core.auth import hash_password

    user = User(
        email=email,
        first_name="Pat",
        last_name="Example",
        hashed_password=hash_password("pass1234"),
        status="active",
    )
    db.add(user)
    db.commit()
    return user


def _url(tournament_id: int, track_id: int, suffix: str = "") -> str:
    return f"/tournaments/{tournament_id}/tracks/{track_id}/discord/{suffix}"


def _start(client, tournament_id: int, track_id: int, **params):
    return client.get(
        _url(tournament_id, track_id, "install/"), params=params or None, follow_redirects=False
    )


def _state(response) -> str:
    return parse_qs(urlparse(response.headers["location"]).query)["state"][0]


def _finish(client, mock_discord_http, state: str, guild: dict | None, **params):
    def fake(method, path, **kwargs):
        assert path == "/oauth2/token"
        assert kwargs["data"]["redirect_uri"].endswith("/api/proxy/discord/install/callback")
        token = {"access_token": "user-token", "token_type": "Bearer"}
        if guild is not None:
            token["guild"] = guild
        return token

    mock_discord_http.side_effect = fake
    return client.get(
        "/discord/install/callback/",
        params={"code": "auth-code", "state": state, **params},
        follow_redirects=False,
    )


def _guild(guild_id: int = GUILD_ID, owner_id: str = TD_DISCORD, name: str = "Test Server"):
    return {"id": str(guild_id), "name": name, "owner_id": owner_id}


def _install(client, mock_discord_http, tournament_id, track_id, guild=None, **start_params):
    state = _state(_start(client, tournament_id, track_id, **start_params))
    return _finish(client, mock_discord_http, state, guild or _guild())


def _location_query(response) -> dict[str, str]:
    location = urlparse(response.headers["location"])
    return {k: v[0] for k, v in parse_qs(location.query).items()}


def _add_link(db, tournament, track_id: int, guild_id: int = GUILD_ID, **fields):
    link = DiscordGuildLink(
        tournament_id=tournament.id, track_id=track_id, guild_id=guild_id, **fields
    )
    db.add(link)
    db.commit()
    return link


class TestStartInstall:
    def test_404_when_discord_is_off(self, client, td_user, td_tournament, track_id):
        login(client, "td@test.com", "tdpass")
        assert _start(client, td_tournament.id, track_id).status_code == 404

    def test_redirects_to_discord_for_a_bot_install(
        self, client, discord_on, td_user, td_tournament, track_id
    ):
        login(client, "td@test.com", "tdpass")
        res = _start(client, td_tournament.id, track_id, merge_divisions="true")
        assert res.status_code == 302
        location = urlparse(res.headers["location"])
        assert location.netloc == "discord.com" and location.path == "/oauth2/authorize"
        query = parse_qs(location.query)
        assert query["scope"] == ["bot applications.commands identify"]
        assert query["permissions"] == ["8"]
        assert query["response_type"] == ["code"]
        assert query["client_id"] == ["1000"]
        assert query["redirect_uri"] == ["http://localhost:3000/api/proxy/discord/install/callback"]
        assert "guild_id" not in query and "disable_guild_select" not in query
        assert "oauth_state" in res.cookies

    def test_adding_the_bot_back_locks_the_server_picker(
        self, client, db, discord_on, td_user, td_tournament, track_id
    ):
        _add_link(db, td_tournament, track_id, bot_removed_at=utcnow())
        login(client, "td@test.com", "tdpass")
        res = _start(client, td_tournament.id, track_id)
        query = parse_qs(urlparse(res.headers["location"]).query)
        assert query["guild_id"] == [str(GUILD_ID)]
        assert query["disable_guild_select"] == ["true"]

    def test_requires_manage_discord(self, client, db, discord_on, td_tournament, track_id):
        grant_role(db, td_tournament, _make_user(db, "vol@test.com"), "Volunteer")
        login(client, "vol@test.com", "pass1234")
        assert _start(client, td_tournament.id, track_id).status_code == 403

    def test_other_tournaments_track_is_404(
        self, client, db, discord_on, td_user, td_tournament, other_tournament
    ):
        login(client, "td@test.com", "tdpass")
        other_track = primary_track_id(db, other_tournament.id)
        assert _start(client, td_tournament.id, other_track).status_code == 404

    def test_archived_tournament_is_refused(
        self, client, db, discord_on, td_user, td_tournament, track_id
    ):
        td_tournament.is_archived = True
        db.commit()
        login(client, "td@test.com", "tdpass")
        assert _start(client, td_tournament.id, track_id).status_code == 403

    def test_track_pending_deletion_is_refused(
        self, client, db, discord_on, td_user, td_tournament, track_id
    ):
        db.get(TournamentTrack, track_id).is_archived = True
        db.commit()
        login(client, "td@test.com", "tdpass")
        assert _start(client, td_tournament.id, track_id).status_code == 409

    def test_linked_track_is_refused(
        self, client, db, discord_on, td_user, td_tournament, track_id
    ):
        _add_link(db, td_tournament, track_id)
        login(client, "td@test.com", "tdpass")
        assert _start(client, td_tournament.id, track_id).status_code == 409


class TestFinishInstall:
    def test_links_a_server_owned_by_the_tournament_owner(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        _link_discord(db, td_user, TD_DISCORD)
        login(client, "td@test.com", "tdpass")
        res = _install(
            client,
            mock_discord_http,
            td_tournament.id,
            track_id,
            merge_divisions="true",
            category_grouping="zone",
        )
        assert res.headers["location"] == (
            f"http://localhost:3000/dashboard/tournaments/{td_tournament.id}/settings/discord"
            f"?linked={track_id}"
        )
        link = db.query(DiscordGuildLink).one()
        assert (link.track_id, link.guild_id, link.guild_name) == (
            track_id,
            GUILD_ID,
            "Test Server",
        )
        assert link.merge_divisions is True
        assert link.category_grouping == "zone"
        assert link.installed_by_user_id == td_user.id
        assert link.built_at is None
        assert left == []
        entry = db.query(AuditLogEntry).filter_by(action=DISCORD_SERVER_LINKED).one()
        assert entry.target_id == track_id
        assert entry.extra_data == {
            "track_name": "Main",
            "guild_id": str(GUILD_ID),
            "guild_name": "Test Server",
        }

    def test_forged_guild_id_in_the_redirect_is_ignored(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        _link_discord(db, td_user, TD_DISCORD)
        login(client, "td@test.com", "tdpass")
        state = _state(_start(client, td_tournament.id, track_id))
        _finish(client, mock_discord_http, state, _guild(), guild_id="999")
        assert db.query(DiscordGuildLink).one().guild_id == GUILD_ID

    def test_owner_without_a_linked_discord_account_is_refused(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        login(client, "td@test.com", "tdpass")
        res = _install(client, mock_discord_http, td_tournament.id, track_id)
        assert _location_query(res) == {"error": "owner_not_linked"}
        assert db.query(DiscordGuildLink).count() == 0
        assert left == [GUILD_ID]

    def test_owner_without_manage_tournament_is_refused(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        volunteer = _make_user(db, "vol@test.com")
        grant_role(db, td_tournament, volunteer, "Volunteer")
        _link_discord(db, volunteer, "5001")
        login(client, "td@test.com", "tdpass")
        res = _install(
            client, mock_discord_http, td_tournament.id, track_id, guild=_guild(owner_id="5001")
        )
        assert _location_query(res) == {"error": "owner_lacks_permission", "owner": "Pat Example"}
        assert db.query(DiscordGuildLink).count() == 0
        assert left == [GUILD_ID]

    def test_inactive_owner_is_refused(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        coordinator = _make_user(db, "lead@test.com")
        grant_role(db, td_tournament, coordinator, "Tournament Director")
        _link_discord(db, coordinator, "5001")
        coordinator.status = "deactivated"
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = _install(
            client, mock_discord_http, td_tournament.id, track_id, guild=_guild(owner_id="5001")
        )
        assert _location_query(res) == {"error": "owner_inactive", "owner": "Pat Example"}
        assert db.query(DiscordGuildLink).count() == 0
        assert left == [GUILD_ID]

    def test_server_owned_by_a_td_who_isnt_the_tournament_owner(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        director = _make_user(db, "director@test.com")
        grant_role(db, td_tournament, director, "Tournament Director")
        _link_discord(db, director, "5002")
        login(client, "td@test.com", "tdpass")
        res = _install(
            client, mock_discord_http, td_tournament.id, track_id, guild=_guild(owner_id="5002")
        )
        assert "linked" in _location_query(res)
        assert db.query(DiscordGuildLink).count() == 1

    def test_manage_discord_only_installer_when_the_owner_qualifies(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        coordinator = _make_user(db, "vc@test.com")
        grant_role(db, td_tournament, coordinator, "Volunteer Coordinator")
        _link_discord(db, td_user, TD_DISCORD)
        login(client, "vc@test.com", "pass1234")
        res = _install(client, mock_discord_http, td_tournament.id, track_id)
        assert "linked" in _location_query(res)
        assert db.query(DiscordGuildLink).one().installed_by_user_id == coordinator.id

    def test_installer_who_lost_manage_discord_is_refused(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        from app.models.models import TournamentRole

        coordinator = _make_user(db, "vc@test.com")
        grant_role(db, td_tournament, coordinator, "Volunteer Coordinator")
        _link_discord(db, td_user, TD_DISCORD)
        login(client, "vc@test.com", "pass1234")
        state = _state(_start(client, td_tournament.id, track_id))
        role = (
            db.query(TournamentRole)
            .filter_by(tournament_id=td_tournament.id, label="Volunteer Coordinator")
            .one()
        )
        role.permissions = [p for p in role.permissions if p != "manage_discord"]
        db.commit()
        res = _finish(client, mock_discord_http, state, _guild())
        assert _location_query(res) == {"error": "no_permission"}
        assert left == [GUILD_ID]

    def test_server_linked_to_another_track_is_refused_without_leaving(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        day_two = TournamentTrack(tournament_id=td_tournament.id, name="Day 2")
        db.add(day_two)
        db.commit()
        _add_link(db, td_tournament, day_two.id)
        _link_discord(db, td_user, TD_DISCORD)
        login(client, "td@test.com", "tdpass")
        res = _install(client, mock_discord_http, td_tournament.id, track_id)
        assert _location_query(res) == {"error": "guild_linked_elsewhere"}
        assert left == []
        assert db.query(DiscordGuildLink).one().track_id == day_two.id

    def test_track_linked_to_another_server_is_refused(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        _add_link(db, td_tournament, track_id, guild_id=42, bot_removed_at=utcnow())
        _link_discord(db, td_user, TD_DISCORD)
        login(client, "td@test.com", "tdpass")
        res = _install(client, mock_discord_http, td_tournament.id, track_id)
        assert _location_query(res) == {"error": "track_linked_elsewhere"}
        assert left == [GUILD_ID]

    def test_adding_the_bot_back_clears_bot_removed(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        link = _add_link(db, td_tournament, track_id, bot_removed_at=utcnow(), guild_name="Old")
        _link_discord(db, td_user, TD_DISCORD)
        login(client, "td@test.com", "tdpass")
        res = _install(client, mock_discord_http, td_tournament.id, track_id)
        assert "linked" in _location_query(res)
        db.refresh(link)
        assert link.bot_removed_at is None
        assert link.guild_name == "Test Server"
        entry = db.query(AuditLogEntry).filter_by(action=DISCORD_SERVER_LINKED).one()
        assert entry.extra_data["readded"] is True

    def test_tournament_deleted_during_the_install(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        _link_discord(db, td_user, TD_DISCORD)
        login(client, "td@test.com", "tdpass")
        state = _state(_start(client, td_tournament.id, track_id))
        db.delete(td_tournament)
        db.commit()
        res = _finish(client, mock_discord_http, state, _guild())
        assert res.status_code == 302
        assert res.headers["location"] == "http://localhost:3000/dashboard"
        assert db.query(DiscordGuildLink).count() == 0
        assert left == [GUILD_ID]

    def test_state_mismatch(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        login(client, "td@test.com", "tdpass")
        _start(client, td_tournament.id, track_id)
        res = _finish(client, mock_discord_http, "forged", _guild())
        assert _location_query(res) == {"error": "discord_failed"}
        assert mock_discord_http.call_count == 0
        assert left == []

    def test_cancelled_on_discord(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        login(client, "td@test.com", "tdpass")
        state = _state(_start(client, td_tournament.id, track_id))
        res = client.get(
            "/discord/install/callback/",
            params={"error": "access_denied", "state": state},
            follow_redirects=False,
        )
        assert _location_query(res) == {"error": "discord_cancelled"}
        assert left == []

    def test_token_without_a_guild(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_http, left
    ):
        login(client, "td@test.com", "tdpass")
        state = _state(_start(client, td_tournament.id, track_id))
        res = _finish(client, mock_discord_http, state, None)
        assert _location_query(res) == {"error": "discord_no_guild"}
        assert db.query(DiscordGuildLink).count() == 0

    def test_a_refused_install_leaves_before_redirecting(
        self,
        client,
        db,
        discord_on,
        td_user,
        td_tournament,
        track_id,
        mock_discord_http,
        monkeypatch,
        mock_discord_rest,
    ):
        queued: list[int] = []
        monkeypatch.setattr(
            "app.api.routes.discord.guilds.notify_leave",
            lambda db, guild_id: queued.append(guild_id),
        )
        login(client, "td@test.com", "tdpass")
        res = _install(client, mock_discord_http, td_tournament.id, track_id)
        assert _location_query(res) == {"error": "owner_not_linked"}
        assert mock_discord_rest.left == [GUILD_ID]
        assert queued == []

    def test_a_failed_leave_falls_back_to_the_leader(
        self,
        client,
        db,
        discord_on,
        td_user,
        td_tournament,
        track_id,
        mock_discord_http,
        monkeypatch,
        mock_discord_rest,
    ):
        async def broken(guild_id):
            raise RuntimeError("Discord is down")

        queued: list[int] = []
        monkeypatch.setattr(mock_discord_rest, "leave_guild", broken)
        monkeypatch.setattr(
            "app.api.routes.discord.guilds.notify_leave",
            lambda db, guild_id: queued.append(guild_id),
        )
        login(client, "td@test.com", "tdpass")
        res = _install(client, mock_discord_http, td_tournament.id, track_id)
        assert _location_query(res) == {"error": "owner_not_linked"}
        assert queued == [GUILD_ID]

    def test_callback_without_a_started_install(self, client, discord_on, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.get(
            "/discord/install/callback/",
            params={"code": "x", "state": "y"},
            follow_redirects=False,
        )
        assert res.headers["location"] == "http://localhost:3000/dashboard"


class TestTrackDiscordSettings:
    def test_status_without_a_link(self, client, discord_on, td_user, td_tournament, track_id):
        login(client, "td@test.com", "tdpass")
        res = client.get(_url(td_tournament.id, track_id))
        assert res.status_code == 200
        assert res.json() == {"track_id": track_id, "link": None}

    def test_status_with_a_link(self, client, db, discord_on, td_user, td_tournament, track_id):
        _add_link(
            db, td_tournament, track_id, guild_name="Test Server", installed_by_user_id=td_user.id
        )
        login(client, "td@test.com", "tdpass")
        link = client.get(_url(td_tournament.id, track_id)).json()["link"]
        assert link["guild_id"] == str(GUILD_ID)
        assert link["guild_name"] == "Test Server"
        assert link["installed_by_name"] == "TD User"
        assert link["merge_divisions"] is False
        assert link["category_grouping"] == "building"
        assert link["built_at"] is None

    def test_status_requires_manage_discord(self, client, db, discord_on, td_tournament, track_id):
        volunteer = _make_user(db, "vol@test.com")
        grant_role(db, td_tournament, volunteer, "Volunteer")
        login(client, "vol@test.com", "pass1234")
        assert client.get(_url(td_tournament.id, track_id)).status_code == 403

    def test_update_settings(self, client, db, discord_on, td_user, td_tournament, track_id):
        link = _add_link(db, td_tournament, track_id)
        login(client, "td@test.com", "tdpass")
        res = client.patch(
            _url(td_tournament.id, track_id),
            json={"merge_divisions": True, "category_grouping": "zone"},
        )
        assert res.status_code == 200
        assert res.json()["link"]["category_grouping"] == "zone"
        db.refresh(link)
        assert (link.merge_divisions, link.category_grouping) == (True, "zone")
        entry = db.query(AuditLogEntry).filter_by(action=DISCORD_SETTINGS_UPDATED).one()
        assert entry.extra_data == {
            "track_name": "Main",
            "changes": [
                {"field": "merge_divisions", "old": False, "new": True},
                {"field": "category_grouping", "old": "building", "new": "zone"},
            ],
        }

    def test_update_without_changes_logs_nothing(
        self, client, db, discord_on, td_user, td_tournament, track_id
    ):
        _add_link(db, td_tournament, track_id)
        login(client, "td@test.com", "tdpass")
        res = client.patch(_url(td_tournament.id, track_id), json={"merge_divisions": False})
        assert res.status_code == 200
        assert db.query(AuditLogEntry).filter_by(action=DISCORD_SETTINGS_UPDATED).count() == 0

    def test_update_rejects_unknown_grouping(
        self, client, db, discord_on, td_user, td_tournament, track_id
    ):
        _add_link(db, td_tournament, track_id)
        login(client, "td@test.com", "tdpass")
        res = client.patch(_url(td_tournament.id, track_id), json={"category_grouping": "floor"})
        assert res.status_code == 422

    def test_update_without_a_link_is_404(
        self, client, discord_on, td_user, td_tournament, track_id
    ):
        login(client, "td@test.com", "tdpass")
        res = client.patch(_url(td_tournament.id, track_id), json={"merge_divisions": True})
        assert res.status_code == 404

    def test_update_refused_when_archived(
        self, client, db, discord_on, td_user, td_tournament, track_id
    ):
        _add_link(db, td_tournament, track_id)
        td_tournament.is_archived = True
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(_url(td_tournament.id, track_id), json={"merge_divisions": True})
        assert res.status_code == 403

    def test_unlink_leaves_the_server(
        self, client, db, discord_on, td_user, td_tournament, track_id, left
    ):
        _add_link(db, td_tournament, track_id, guild_name="Test Server")
        login(client, "td@test.com", "tdpass")
        assert client.delete(_url(td_tournament.id, track_id)).status_code == 204
        assert db.query(DiscordGuildLink).count() == 0
        assert left == [GUILD_ID]
        entry = db.query(AuditLogEntry).filter_by(action=DISCORD_SERVER_UNLINKED).one()
        assert entry.extra_data == {
            "track_name": "Main",
            "guild_id": str(GUILD_ID),
            "guild_name": "Test Server",
        }

    def test_unlink_requires_manage_discord(
        self, client, db, discord_on, td_tournament, track_id, left
    ):
        _add_link(db, td_tournament, track_id)
        volunteer = _make_user(db, "vol@test.com")
        grant_role(db, td_tournament, volunteer, "Volunteer")
        login(client, "vol@test.com", "pass1234")
        assert client.delete(_url(td_tournament.id, track_id)).status_code == 403
        assert left == []

    def test_deleting_the_track_deletes_the_link(self, db, td_tournament, track_id):
        _add_link(db, td_tournament, track_id)
        db.delete(db.get(TournamentTrack, track_id))
        db.commit()
        assert db.query(DiscordGuildLink).count() == 0


class TestBuildRoute:
    @pytest.fixture
    def guild(self, mock_discord_rest):
        return mock_discord_rest.add_guild(GUILD_ID)

    def _build(self, client, tournament_id, track_id, **body):
        return client.post(_url(tournament_id, track_id, "build/"), json=body)

    def test_preview_then_confirm(
        self, client, db, discord_on, td_user, td_tournament, track_id, guild, mock_discord_rest
    ):
        link = _add_link(db, td_tournament, track_id)
        login(client, "td@test.com", "tdpass")
        res = self._build(client, td_tournament.id, track_id)
        assert res.status_code == 200
        preview = res.json()
        titles = [g["title"] for g in preview["groups"]]
        assert titles[0] == "Create" and titles[-1] == "Gate"
        assert preview["blockers"] == []
        assert preview["preview_token"]
        assert mock_discord_rest.writes == []

        res = self._build(
            client,
            td_tournament.id,
            track_id,
            dry_run=False,
            preview_token=preview["preview_token"],
        )
        assert res.status_code == 202
        db.refresh(link)
        assert link.built_at is not None
        assert link.last_build_status == "succeeded"
        assert guild.channel("verify")

    def test_confirm_needs_a_preview(
        self, client, db, discord_on, td_user, td_tournament, track_id, guild
    ):
        _add_link(db, td_tournament, track_id)
        login(client, "td@test.com", "tdpass")
        assert self._build(client, td_tournament.id, track_id, dry_run=False).status_code == 400

    def test_preview_token_is_bound_to_its_user_and_kind(
        self, client, db, discord_on, td_user, td_tournament, track_id, guild
    ):
        from app.core.discord.previews import sign

        link = _add_link(db, td_tournament, track_id)
        login(client, "td@test.com", "tdpass")
        for token in (
            sign(link.id, False, None, "u999999"),
            sign(link.id, True, None, f"u{td_user.id}"),
            sign(link.id + 1, False, None, f"u{td_user.id}"),
        ):
            res = self._build(
                client, td_tournament.id, track_id, dry_run=False, preview_token=token
            )
            assert res.status_code == 400

    def test_expired_preview(
        self, client, db, discord_on, td_user, td_tournament, track_id, guild, monkeypatch
    ):
        from app.core.discord import previews

        _add_link(db, td_tournament, track_id)
        login(client, "td@test.com", "tdpass")
        token = self._build(client, td_tournament.id, track_id).json()["preview_token"]
        later = previews.time.time() + previews.EXPIRY_SECONDS + 1
        monkeypatch.setattr(previews.time, "time", lambda: later)
        res = self._build(client, td_tournament.id, track_id, dry_run=False, preview_token=token)
        assert res.status_code == 409

    def test_one_build_at_a_time(
        self, client, db, discord_on, td_user, td_tournament, track_id, guild
    ):
        link = _add_link(db, td_tournament, track_id)
        login(client, "td@test.com", "tdpass")
        token = self._build(client, td_tournament.id, track_id).json()["preview_token"]
        link.last_build_status = "running"
        link.last_build_at = utcnow()
        db.commit()
        res = self._build(client, td_tournament.id, track_id, dry_run=False, preview_token=token)
        assert res.status_code == 409

    def test_reset_needs_a_built_server(
        self, client, db, discord_on, td_user, td_tournament, track_id, guild
    ):
        _add_link(db, td_tournament, track_id)
        login(client, "td@test.com", "tdpass")
        assert self._build(client, td_tournament.id, track_id, reset=True).status_code == 409

    def test_refused_when_the_bot_was_removed(
        self, client, db, discord_on, td_user, td_tournament, track_id, guild
    ):
        _add_link(db, td_tournament, track_id, bot_removed_at=utcnow())
        login(client, "td@test.com", "tdpass")
        assert self._build(client, td_tournament.id, track_id).status_code == 409

    def test_refused_when_archived(
        self, client, db, discord_on, td_user, td_tournament, track_id, guild
    ):
        _add_link(db, td_tournament, track_id)
        td_tournament.is_archived = True
        db.commit()
        login(client, "td@test.com", "tdpass")
        assert self._build(client, td_tournament.id, track_id).status_code == 403

    def test_requires_manage_discord(self, client, db, discord_on, td_tournament, track_id, guild):
        _add_link(db, td_tournament, track_id)
        grant_role(db, td_tournament, _make_user(db, "vol@test.com"), "Volunteer")
        login(client, "vol@test.com", "pass1234")
        assert self._build(client, td_tournament.id, track_id).status_code == 403

    def test_blocked_preview_has_no_token(
        self, client, db, discord_on, td_user, td_tournament, track_id, guild
    ):
        guild.roles[guild.bot_role]["permissions"] = "0"
        _add_link(db, td_tournament, track_id)
        login(client, "td@test.com", "tdpass")
        preview = self._build(client, td_tournament.id, track_id).json()
        assert "Administrator" in preview["blockers"][0]
        assert preview["preview_token"] is None

    def test_discord_error_is_502(
        self, client, db, discord_on, td_user, td_tournament, track_id, mock_discord_rest
    ):
        from unittest.mock import Mock

        import discord

        async def forbidden(guild_id):
            raise discord.Forbidden(
                Mock(status=403, reason="Forbidden"),
                {"message": "Missing Access", "code": 50001},
            )

        mock_discord_rest.guild = forbidden
        _add_link(db, td_tournament, track_id)
        login(client, "td@test.com", "tdpass")
        res = self._build(client, td_tournament.id, track_id)
        assert res.status_code == 502
        assert "Missing Access" in res.json()["detail"]
