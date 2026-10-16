"""The interactions endpoint: signatures, PING, and the slash commands. Requests are signed with
DISCORD_TEST_KEY, whose public half `discord_on` installs."""

import json
import time
from datetime import UTC, datetime, timedelta

import pytest

from app.models.discord import DiscordGuildLink
from app.models.models import (
    OAuthIdentity,
    OAuthProvider,
    TournamentEvent,
    TournamentEventShift,
    TournamentEventTrack,
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
        assert _content(res) == "NEXUS commands work only inside servers."

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
        assert "aren't on staff" not in content

    def test_linked_but_not_on_staff(self, client, db, discord_on, link):
        _link_discord(db, _make_user(db, "nobody@test.com"), "5002")
        content = _content(_post(client, _command("whoami", user_id="5002")))
        assert "aren't on staff" in content

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
        assert _content(_post(client, _command("setup", user_id="5006"))) == (
            "/setup isn't available yet."
        )

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
        assert _content(_post(client, _command("setup", user_id="5007"))) == (
            "/setup isn't available yet."
        )
