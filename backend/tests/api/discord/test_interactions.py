"""The interactions endpoint: signatures, PING, and the slash commands. Requests are signed with
DISCORD_TEST_KEY, whose public half `discord_on` installs."""

import json
import time
from datetime import UTC, datetime, timedelta

import pytest

from app.models.discord import DiscordGuildLink, DiscordSyncMark
from app.models.models import (
    OAuthIdentity,
    OAuthProvider,
    TournamentEvent,
    TournamentEventShift,
    TournamentEventTrack,
    TournamentMembership,
    TournamentRole,
    TournamentShift,
    TournamentTrack,
    TournamentTrackAssignment,
    User,
    utcnow,
)
from app.services.discord.interactions import EPHEMERAL
from tests.conftest import DISCORD_TEST_KEY, grant_role, primary_track_id

GUILD_ID = "1560569782195978320"
TD_DISCORD = "4001"
CONNECT_URL = "http://localhost:3000/connect/discord"


def _post(client, payload: dict, *, signature: str | None = None, timestamp: str | None = None):
    body = json.dumps(payload).encode()
    timestamp = timestamp or str(int(time.time()))
    if signature is None:
        signature = DISCORD_TEST_KEY.sign(timestamp.encode() + body).hex()
    return client.post(
        "/discord/interactions/",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Signature-Ed25519": signature,
            "X-Signature-Timestamp": timestamp,
        },
    )


def _command(name: str, user_id: str = TD_DISCORD, guild_id: str | None = GUILD_ID, **options):
    payload: dict = {
        "type": 2,
        "token": "command-token",
        "data": {
            "name": name,
            "options": [{"name": k, "type": 8, "value": v} for k, v in options.items()],
        },
    }
    if guild_id is not None:
        payload["guild_id"] = guild_id
        payload["member"] = {"user": {"id": user_id}, "roles": []}
    else:
        payload["user"] = {"id": user_id}
    return payload


def _content(response) -> str:
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == 4
    assert body["data"]["flags"] == EPHEMERAL
    return body["data"]["content"]


def _link_url(response) -> str:
    [row] = response.json()["data"]["components"]
    [button] = row["components"]
    assert button["style"] == 5
    return button["url"]


def _link_discord(db, user: User, account_id: str) -> None:
    db.add(
        OAuthIdentity(
            user_id=user.id, provider=OAuthProvider.discord, provider_account_id=account_id
        )
    )
    db.commit()


def _make_user(db, email: str, first: str = "Pat", last: str = "Example") -> User:
    user = User(email=email, first_name=first, last_name=last, status="active")
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def track_id(db, td_tournament) -> int:
    return primary_track_id(db, td_tournament.id)


@pytest.fixture
def link(db, td_tournament, track_id) -> DiscordGuildLink:
    link = DiscordGuildLink(
        tournament_id=td_tournament.id, track_id=track_id, guild_id=int(GUILD_ID)
    )
    db.add(link)
    db.commit()
    return link


class TestEndpoint:
    def test_404_when_discord_is_off(self, client):
        assert _post(client, {"type": 1}).status_code == 404

    def test_ping_gets_pong(self, client, discord_on):
        res = _post(client, {"type": 1})
        assert res.status_code == 200
        assert res.json() == {"type": 1}

    def test_bad_signature_is_401(self, client, discord_on):
        res = _post(client, {"type": 1}, signature="00" * 64)
        assert res.status_code == 401

    def test_signature_over_other_bytes_is_401(self, client, discord_on):
        body = json.dumps({"type": 1}).encode()
        timestamp = str(int(time.time()))
        signature = DISCORD_TEST_KEY.sign(timestamp.encode() + body + b" ").hex()
        assert (
            _post(client, {"type": 1}, signature=signature, timestamp=timestamp).status_code == 401
        )

    def test_missing_signature_headers_is_401(self, client, discord_on):
        res = client.post("/discord/interactions/", json={"type": 1})
        assert res.status_code == 401

    def test_needs_no_api_key(self, client, discord_on, monkeypatch):
        from app.core.config import get_settings

        monkeypatch.setattr(get_settings(), "api_key", "secret")
        assert client.get("/users/me/").status_code == 403
        assert _post(client, {"type": 1}).status_code == 200

    def test_not_in_the_public_api_reference(self, client):
        assert "/discord/interactions/" not in client.get("/openapi.json").json()["paths"]


class TestServerState:
    def test_dm_is_refused(self, client, discord_on):
        res = _post(client, _command("whoami", guild_id=None))
        assert _content(res) == "lobot's commands work only inside servers."

    def test_unlinked_server(self, client, discord_on):
        assert _content(_post(client, _command("link"))) == (
            "This server isn't linked to a NEXUS track."
        )

    def test_archived_tournament(self, client, db, discord_on, link, td_tournament):
        td_tournament.is_archived = True
        db.commit()
        assert _content(_post(client, _command("whoami"))) == "This tournament is archived."

    def test_track_pending_deletion(self, client, db, discord_on, link, track_id):
        db.get(TournamentTrack, track_id).is_archived = True
        db.commit()
        assert _content(_post(client, _command("whoami"))) == "This track is being deleted."


class TestLink:
    def test_replies_with_a_link_button(self, client, discord_on, link):
        res = _post(client, _command("link"))
        assert "Link your Discord account" in _content(res)
        assert _link_url(res) == CONNECT_URL


class TestWhoami:
    def test_unlinked_user_gets_the_link_button(self, client, discord_on, link):
        res = _post(client, _command("whoami", user_id="9999"))
        assert _content(res) == "Your Discord account isn't linked to NEXUS."
        assert _link_url(res) == CONNECT_URL

    def test_owner_without_roles(self, client, db, discord_on, link, td_tournament):
        owner = _make_user(db, "owner@test.com", "Olive", "Owner")
        td_tournament.owner_id = owner.id
        db.commit()
        _link_discord(db, owner, "5001")
        content = _content(_post(client, _command("whoami", user_id="5001")))
        assert "**Olive Owner**" in content
        assert "You own" in content
        assert "don't have a role or assignment" not in content

    def test_linked_without_a_role_or_assignment(self, client, db, discord_on, link):
        _link_discord(db, _make_user(db, "nobody@test.com"), "5002")
        content = _content(_post(client, _command("whoami", user_id="5002")))
        assert "don't have a role or assignment" in content

    def test_inactive_account(self, client, db, discord_on, link, td_tournament):
        volunteer = _make_user(db, "vol@test.com")
        _link_discord(db, volunteer, "5003")
        grant_role(db, td_tournament, volunteer, "Volunteer")
        volunteer.status = "locked"
        db.commit()
        content = _content(_post(client, _command("whoami", user_id="5003")))
        assert content == "Your NEXUS account (Pat Example) isn't active."

    def test_declined_age_disclosure_shows_no_roles(
        self, client, db, discord_on, link, td_tournament
    ):
        volunteer = _make_user(db, "vol@test.com")
        _link_discord(db, volunteer, "5003")
        grant_role(db, td_tournament, volunteer, "Volunteer")
        membership = (
            db.query(TournamentMembership)
            .filter_by(user_id=volunteer.id, tournament_id=td_tournament.id)
            .one()
        )
        membership.age_disclosure = "declined"
        db.commit()
        content = _content(_post(client, _command("whoami", user_id="5003")))
        assert "**Roles**" not in content
        assert "don't have a role or assignment" in content

    def test_roles_on_this_track_and_tournament_wide_only(
        self, client, db, discord_on, link, td_tournament, track_id
    ):
        volunteer = _make_user(db, "vol@test.com")
        _link_discord(db, volunteer, "5003")
        grant_role(db, td_tournament, volunteer, "Volunteer Coordinator")
        grant_role(db, td_tournament, volunteer, "Runner", track_id=track_id)
        other_track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
        db.add(other_track)
        db.commit()
        grant_role(db, td_tournament, volunteer, "Test Writer", track_id=other_track.id)

        content = _content(_post(client, _command("whoami", user_id="5003")))
        roles_line = next(line for line in content.splitlines() if line.startswith("**Roles**"))
        assert "Volunteer Coordinator (tournament-wide)" in roles_line
        assert "Runner" in roles_line
        assert "Test Writer" not in roles_line

    def test_events_with_shift_times(self, client, db, discord_on, link, td_tournament, track_id):
        volunteer = _make_user(db, "vol@test.com")
        _link_discord(db, volunteer, "5004")
        membership = grant_role(db, td_tournament, volunteer, "Volunteer", track_id=track_id)
        role = (
            db.query(TournamentRole)
            .filter_by(tournament_id=td_tournament.id, label="Volunteer")
            .one()
        )
        start = datetime(2027, 4, 10, 15, 0, tzinfo=UTC)
        shift = TournamentShift(
            tournament_id=td_tournament.id,
            track_id=track_id,
            label="Block 1",
            start=start,
            end=start + timedelta(hours=2),
        )
        circuit = TournamentEvent(tournament_id=td_tournament.id, name="Circuit Lab", division="C")
        anatomy = TournamentEvent(tournament_id=td_tournament.id, name="Anatomy", division="B")
        db.add_all([shift, circuit, anatomy])
        db.flush()
        db.add_all(
            [
                TournamentEventTrack(tournament_event_id=circuit.id, track_id=track_id),
                TournamentEventTrack(tournament_event_id=anatomy.id, track_id=track_id),
                TournamentEventShift(tournament_event_id=circuit.id, tournament_shift_id=shift.id),
            ]
        )
        db.flush()
        db.add_all(
            [
                TournamentTrackAssignment(
                    membership_id=membership.id,
                    role_id=role.id,
                    tournament_track_id=track_id,
                    tournament_event_id=circuit.id,
                    tournament_shift_id=shift.id,
                ),
                TournamentTrackAssignment(
                    membership_id=membership.id,
                    role_id=role.id,
                    tournament_track_id=track_id,
                    tournament_event_id=anatomy.id,
                ),
            ]
        )
        db.commit()

        content = _content(_post(client, _command("whoami", user_id="5004")))
        stamp = int(start.timestamp())
        assert "• Anatomy B" in content
        assert f"• Circuit Lab C, Block 1: <t:{stamp}:f> to <t:{stamp + 7200}:t>" in content
        assert content.index("Anatomy B") < content.index("Circuit Lab C")


class TestStaffCommands:
    @pytest.mark.parametrize("name", ["sync", "setup", "reset"])
    def test_unlinked_user_is_told_to_link(self, client, discord_on, link, name):
        res = _post(client, _command(name, user_id="9999"))
        assert _content(res) == "Link your NEXUS account first."
        assert _link_url(res) == CONNECT_URL

    @pytest.mark.parametrize("name", ["sync", "setup", "reset"])
    def test_refused_without_manage_discord(
        self, client, db, discord_on, link, td_tournament, name
    ):
        volunteer = _make_user(db, "vol@test.com")
        _link_discord(db, volunteer, "5005")
        grant_role(db, td_tournament, volunteer, "Volunteer")
        res = _post(client, _command(name, user_id="5005"))
        assert _content(res) == "You need the Manage Discord permission in NEXUS to run this."

    def test_manage_discord_without_manage_tournament_is_allowed(
        self, client, db, discord_on, link, td_tournament
    ):
        coordinator = _make_user(db, "vc@test.com")
        _link_discord(db, coordinator, "5006")
        grant_role(db, td_tournament, coordinator, "Volunteer Coordinator")
        assert _post(client, _command("setup", user_id="5006")).json() == {
            "type": 5,
            "data": {"flags": EPHEMERAL},
        }

    @pytest.mark.parametrize("status", ["deactivated", "locked"])
    def test_refused_for_an_inactive_account(self, client, db, discord_on, link, td_user, status):
        _link_discord(db, td_user, TD_DISCORD)
        td_user.status = status
        db.commit()
        content = _content(_post(client, _command("sync")))
        assert content.endswith("isn't active.")
        assert db.query(DiscordSyncMark).count() == 0

    @pytest.mark.parametrize("name", ["sync", "reset"])
    def test_unbuilt_server_needs_setup_first(self, client, db, discord_on, link, td_user, name):
        _link_discord(db, td_user, TD_DISCORD)
        assert _content(_post(client, _command(name))) == "Run /setup first."

    def test_reset_with_both_options_is_refused(self, client, db, discord_on, link, td_user):
        link.built_at = utcnow()
        db.commit()
        _link_discord(db, td_user, TD_DISCORD)
        res = _post(client, _command("reset", role="1", channel="2"))
        assert _content(res) == "Pick a role or a channel to reset, not both."

    def test_site_admin_passes_the_nexus_check(self, client, db, discord_on, link, admin_user):
        _link_discord(db, admin_user, "5007")
        assert _post(client, _command("setup", user_id="5007")).json() == {
            "type": 5,
            "data": {"flags": EPHEMERAL},
        }


def _click(custom_id: str, user_id: str = TD_DISCORD, roles: list[str] | None = None):
    return {
        "type": 3,
        "token": "click-token",
        "guild_id": GUILD_ID,
        "member": {"user": {"id": user_id}, "roles": roles or []},
        "data": {"custom_id": custom_id, "component_type": 2},
    }


@pytest.fixture
def guild(mock_discord_rest):
    return mock_discord_rest.add_guild(int(GUILD_ID))


@pytest.fixture(autouse=True)
def _fresh_verify_cooldowns(monkeypatch):
    monkeypatch.setattr("app.core.discord.interactions._verify_clicks", {})


def _last_reply(mock_discord_rest, token: str) -> dict:
    replies = [payload for t, payload in mock_discord_rest.interaction_replies if t == token]
    assert replies, f"no reply edited through {token}"
    return replies[-1]


def _buttons(payload: dict) -> list[dict]:
    return [c for row in payload.get("components", []) for c in row["components"]]


class TestSetupAndReset:
    def _setup_preview(self, client, db, td_user, mock_discord_rest) -> dict:
        _link_discord(db, td_user, TD_DISCORD)
        res = _post(client, _command("setup"))
        assert res.json() == {"type": 5, "data": {"flags": EPHEMERAL}}
        return _last_reply(mock_discord_rest, "command-token")

    def _built(self, client, db, td_user, mock_discord_rest) -> None:
        preview = self._setup_preview(client, db, td_user, mock_discord_rest)
        _post(client, _click(_buttons(preview)[0]["custom_id"]))

    def test_setup_previews_with_confirm_and_cancel(
        self, client, db, discord_on, link, td_user, guild, mock_discord_rest
    ):
        preview = self._setup_preview(client, db, td_user, mock_discord_rest)
        assert preview["content"].startswith("**Preview of /setup**")
        assert "**Create**" in preview["content"]
        assert "Unverified members will no longer see" in preview["content"]
        confirm, cancel = _buttons(preview)
        assert confirm["custom_id"].startswith("nexus:go:")
        assert confirm["style"] == 1
        assert cancel["custom_id"] == "nexus:cancel"
        assert mock_discord_rest.writes == []

    def test_confirm_builds_and_reports(
        self, client, db, discord_on, link, td_user, guild, mock_discord_rest
    ):
        preview = self._setup_preview(client, db, td_user, mock_discord_rest)
        res = _post(client, _click(_buttons(preview)[0]["custom_id"]))
        assert res.json()["type"] == 7
        assert res.json()["data"]["content"].startswith("Building")
        db.refresh(link)
        assert link.built_at is not None
        assert link.last_build_status == "succeeded"
        assert _last_reply(mock_discord_rest, "click-token")["content"].startswith("Done.")
        assert guild.channel("verify")

    def test_nothing_to_change_after_a_build(
        self, client, db, discord_on, link, td_user, guild, mock_discord_rest
    ):
        self._built(client, db, td_user, mock_discord_rest)
        _post(client, _command("setup"))
        assert _last_reply(mock_discord_rest, "command-token")["content"] == (
            "Nothing to change. This server matches NEXUS."
        )

    def test_only_the_person_who_ran_it_can_confirm(
        self, client, db, discord_on, link, td_user, guild, mock_discord_rest, td_tournament
    ):
        preview = self._setup_preview(client, db, td_user, mock_discord_rest)
        other = _make_user(db, "vc@test.com")
        _link_discord(db, other, "5008")
        grant_role(db, td_tournament, other, "Volunteer Coordinator")
        res = _post(client, _click(_buttons(preview)[0]["custom_id"], user_id="5008"))
        assert _content(res) == "Only the person who ran the command can confirm it."
        db.refresh(link)
        assert link.built_at is None

    def test_expired_preview_is_refused(
        self, client, db, discord_on, link, td_user, guild, mock_discord_rest, monkeypatch
    ):
        from app.core.discord import previews

        preview = self._setup_preview(client, db, td_user, mock_discord_rest)
        later = previews.time.time() + previews.EXPIRY_SECONDS + 1
        monkeypatch.setattr(previews.time, "time", lambda: later)
        res = _post(client, _click(_buttons(preview)[0]["custom_id"]))
        assert res.json()["data"]["content"] == "This preview expired. Run the command again."
        db.refresh(link)
        assert link.built_at is None

    def test_confirm_rechecks_manage_discord(
        self, client, db, discord_on, link, guild, mock_discord_rest, td_tournament
    ):
        coordinator = _make_user(db, "vc@test.com")
        _link_discord(db, coordinator, "5009")
        grant_role(db, td_tournament, coordinator, "Volunteer Coordinator")
        _post(client, _command("setup", user_id="5009"))
        confirm = _buttons(_last_reply(mock_discord_rest, "command-token"))[0]["custom_id"]
        role = (
            db.query(TournamentRole)
            .filter_by(tournament_id=td_tournament.id, label="Volunteer Coordinator")
            .one()
        )
        role.permissions = []
        db.commit()
        res = _post(client, _click(confirm, user_id="5009"))
        assert _content(res) == "You need the Manage Discord permission in NEXUS to run this."

    def test_one_build_at_a_time(
        self, client, db, discord_on, link, td_user, guild, mock_discord_rest
    ):
        preview = self._setup_preview(client, db, td_user, mock_discord_rest)
        link.last_build_status = "running"
        link.last_build_at = utcnow()
        db.commit()
        res = _post(client, _click(_buttons(preview)[0]["custom_id"]))
        assert res.json()["data"]["content"].startswith("A build is already running")

    def test_cancel(self, client, discord_on, link):
        res = _post(client, _click("nexus:cancel"))
        assert res.json() == {
            "type": 7,
            "data": {
                "content": "Cancelled. Nothing changed.",
                "components": [],
                "allowed_mentions": {"parse": []},
            },
        }

    def test_reset_confirm_is_red(
        self, client, db, discord_on, link, td_user, guild, mock_discord_rest
    ):
        self._built(client, db, td_user, mock_discord_rest)
        guild.role("Volunteer Coordinator")["name"] = "VC"
        _post(client, _command("reset"))
        preview = _last_reply(mock_discord_rest, "command-token")
        assert "Volunteer Coordinator: renamed from VC" in preview["content"]
        assert _buttons(preview)[0]["style"] == 4

    def test_scoped_reset_of_an_unmanaged_role_has_no_confirm(
        self, client, db, discord_on, link, td_user, guild, mock_discord_rest
    ):
        self._built(client, db, td_user, mock_discord_rest)
        mods = guild.add_role("Mods")
        _post(client, _command("reset", role=str(mods)))
        preview = _last_reply(mock_discord_rest, "command-token")
        assert "lobot doesn't manage this." in preview["content"]
        assert [b["custom_id"] for b in _buttons(preview)] == ["nexus:cancel"]

    def test_sync_queues_a_full_sync(self, client, db, discord_on, link, td_user):
        link.built_at = utcnow()
        link.last_sync_warning = "Move lobot's role above Runner."
        db.commit()
        _link_discord(db, td_user, TD_DISCORD)
        content = _content(_post(client, _command("sync")))
        assert content.startswith("Sync queued.")
        assert content.endswith(
            "The last sync finished with a warning: Move lobot's role above Runner."
        )
        mark = db.query(DiscordSyncMark).one()
        assert (mark.link_id, mark.kind) == (link.id, "full")


class TestVerifyButton:
    def test_already_verified(self, client, discord_on):
        # Answered from the click alone: this server isn't even linked.
        res = _post(client, _click("nexus:verify:777", roles=["777"]))
        assert _content(res) == "You're already verified."

    def test_cooldown(self, client, discord_on, link):
        _post(client, _click("nexus:verify:777", user_id="9999"))
        res = _post(client, _click("nexus:verify:777", user_id="9999"))
        assert _content(res).startswith("Try again in")

    def test_unlinked_account_gets_the_link_button(self, client, discord_on, link):
        res = _post(client, _click("nexus:verify:777", user_id="9999"))
        assert _content(res).startswith("Link your Discord account to NEXUS first.")
        assert _link_url(res) == CONNECT_URL

    def test_linked_without_a_role_or_assignment(self, client, db, discord_on, link):
        _link_discord(db, _make_user(db, "nobody@test.com"), "5010")
        content = _content(_post(client, _click("nexus:verify:777", user_id="5010")))
        assert content.startswith(
            "Your NEXUS account (Pat Example) doesn't have a role or assignment in"
        )
        assert content.endswith("Contact the tournament director.")
        assert db.query(DiscordSyncMark).count() == 0

    def test_inactive_account(self, client, db, discord_on, link, td_tournament):
        volunteer = _make_user(db, "vol@test.com")
        _link_discord(db, volunteer, "5010")
        grant_role(db, td_tournament, volunteer, "Volunteer")
        volunteer.status = "deactivated"
        db.commit()
        content = _content(_post(client, _click("nexus:verify:777", user_id="5010")))
        assert content == "Your NEXUS account (Pat Example) isn't active."
        assert db.query(DiscordSyncMark).count() == 0

    def test_eligible_member_is_marked(self, client, db, discord_on, link, td_tournament, track_id):
        volunteer = _make_user(db, "vol@test.com")
        _link_discord(db, volunteer, "5011")
        grant_role(db, td_tournament, volunteer, "Volunteer", track_id=track_id)
        res = _post(client, _click("nexus:verify:777", user_id="5011"))
        assert _content(res) == "You're verified. Your channels will appear in a few seconds."
        mark = db.query(DiscordSyncMark).one()
        assert (mark.link_id, mark.kind, mark.discord_user_id) == (link.id, "member", 5011)

    def test_roles_on_another_track_dont_count(self, client, db, discord_on, link, td_tournament):
        volunteer = _make_user(db, "vol@test.com")
        _link_discord(db, volunteer, "5012")
        other_track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
        db.add(other_track)
        db.commit()
        grant_role(db, td_tournament, volunteer, "Test Writer", track_id=other_track.id)
        content = _content(_post(client, _click("nexus:verify:777", user_id="5012")))
        assert "doesn't have a role or assignment" in content

    def test_site_admins_get_no_special_treatment(self, client, db, discord_on, link, admin_user):
        _link_discord(db, admin_user, "5013")
        content = _content(_post(client, _click("nexus:verify:777", user_id="5013")))
        assert "doesn't have a role or assignment" in content

    def test_owner_without_roles_is_eligible(self, client, db, discord_on, link, td_user):
        _link_discord(db, td_user, TD_DISCORD)
        content = _content(_post(client, _click("nexus:verify:777")))
        assert content.startswith("You're verified.")
