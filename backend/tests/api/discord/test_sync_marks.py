"""Every NEXUS write that changes who holds what, or which roles and events exist, marks the
affected Discord servers in its own transaction. Two built servers: Day 1 (the primary track) and
Day 2."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event as sa_event

from app.core.auth import hash_password
from app.core.discord.marks import mark_memberships
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
    TournamentZone,
    User,
    utcnow,
)
from tests.conftest import grant_role, login, primary_track_id

VOL_DISCORD = 8001
TD_DISCORD = 8000


def _user(db, email: str, discord_id: int | None = None) -> User:
    user = User(
        email=email,
        first_name="Pat",
        last_name="Example",
        hashed_password=hash_password("pass1234"),
        status="active",
    )
    db.add(user)
    db.flush()
    if discord_id is not None:
        db.add(
            OAuthIdentity(
                user_id=user.id, provider=OAuthProvider.discord, provider_account_id=str(discord_id)
            )
        )
    db.commit()
    return user


def _role(db, tournament_id: int, label: str) -> TournamentRole:
    return db.query(TournamentRole).filter_by(tournament_id=tournament_id, label=label).one()


@pytest.fixture
def day1(db, td_tournament) -> int:
    return primary_track_id(db, td_tournament.id)


@pytest.fixture
def day2(db, td_tournament) -> int:
    track = TournamentTrack(tournament_id=td_tournament.id, name="Day 2")
    db.add(track)
    db.commit()
    return track.id


@pytest.fixture
def links(db, td_tournament, td_user, day1, day2) -> dict[str, DiscordGuildLink]:
    made = {}
    for name, track_id, guild_id in [("day1", day1, 101), ("day2", day2, 102)]:
        link = DiscordGuildLink(
            tournament_id=td_tournament.id, track_id=track_id, guild_id=guild_id, built_at=utcnow()
        )
        db.add(link)
        made[name] = link
    db.add(
        OAuthIdentity(
            user_id=td_user.id, provider=OAuthProvider.discord, provider_account_id=str(TD_DISCORD)
        )
    )
    db.commit()
    return made


@pytest.fixture
def volunteer(db) -> User:
    return _user(db, "vol@test.com", VOL_DISCORD)


@pytest.fixture
def event(db, td_tournament, day1) -> TournamentEvent:
    made = TournamentEvent(tournament_id=td_tournament.id, name="Anatomy", division="C")
    db.add(made)
    db.flush()
    db.add(TournamentEventTrack(tournament_event_id=made.id, track_id=day1))
    db.commit()
    return made


@pytest.fixture
def td(client, td_user):
    login(client, "td@test.com", "tdpass")
    return client


def _marks(db, links) -> set[tuple[str, str, int | None]]:
    """(server, kind, Discord user id) for every mark."""
    names = {link.id: name for name, link in links.items()}
    return {(names[m.link_id], m.kind, m.discord_user_id) for m in db.query(DiscordSyncMark)}


def _clear(db) -> None:
    db.query(DiscordSyncMark).delete()
    db.commit()


def _membership(db, tournament_id: int, user: User) -> TournamentMembership:
    return (
        db.query(TournamentMembership).filter_by(tournament_id=tournament_id, user_id=user.id).one()
    )


class TestAssignments:
    def test_a_grant_on_a_track_marks_that_server(
        self, db, td, td_tournament, links, volunteer, day1
    ):
        membership = grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        _clear(db)
        res = td.patch(
            f"/tournaments/{td_tournament.id}/members/{membership.id}/roles/",
            json={"add": [_role(db, td_tournament.id, "Runner").id], "track_id": day1},
        )
        assert res.status_code == 200
        assert _marks(db, links) == {("day1", "member", VOL_DISCORD)}

    def test_a_tournament_wide_grant_marks_every_server(
        self, db, td, td_tournament, links, volunteer
    ):
        membership = grant_role(db, td_tournament, volunteer, "Volunteer")
        _clear(db)
        td.patch(
            f"/tournaments/{td_tournament.id}/members/{membership.id}/roles/",
            json={"add": [_role(db, td_tournament.id, "Runner").id], "is_tournament_wide": True},
        )
        assert _marks(db, links) == {
            ("day1", "member", VOL_DISCORD),
            ("day2", "member", VOL_DISCORD),
        }

    def test_a_no_op_grant_marks_nothing(self, db, td, td_tournament, links, volunteer, day1):
        membership = grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        _clear(db)
        td.patch(
            f"/tournaments/{td_tournament.id}/members/{membership.id}/roles/",
            json={"add": [_role(db, td_tournament.id, "Volunteer").id], "track_id": day1},
        )
        assert _marks(db, links) == set()

    def test_event_assignments_create_update_and_delete(
        self, db, td, td_tournament, links, volunteer, event, day1, day2
    ):
        membership = grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        db.add(TournamentEventTrack(tournament_event_id=event.id, track_id=day2))
        db.commit()
        _clear(db)
        res = td.post(
            f"/tournaments/{td_tournament.id}/assignments/",
            json={
                "tournament_event_id": event.id,
                "membership_id": membership.id,
                "role_id": _role(db, td_tournament.id, "Volunteer").id,
                "tournament_track_id": day1,
            },
        )
        assert res.status_code == 201
        assert _marks(db, links) == {("day1", "member", VOL_DISCORD)}

        _clear(db)
        assignment_id = res.json()["id"]
        res = td.patch(
            f"/tournaments/{td_tournament.id}/assignments/{assignment_id}/",
            json={"tournament_track_id": day2},
        )
        assert res.status_code == 200
        assert _marks(db, links) == {
            ("day1", "member", VOL_DISCORD),
            ("day2", "member", VOL_DISCORD),
        }

        _clear(db)
        res = td.delete(f"/tournaments/{td_tournament.id}/assignments/{assignment_id}/")
        assert res.status_code == 204
        assert _marks(db, links) == {("day2", "member", VOL_DISCORD)}

    def test_placements(self, db, td, td_tournament, links, volunteer, event, day1):
        membership = grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        _clear(db)
        res = td.put(
            f"/tournaments/{td_tournament.id}/assignments/placements/",
            json=[
                {
                    "membership_id": membership.id,
                    "tournament_event_id": event.id,
                    "tournament_track_id": day1,
                    "cells": [
                        {
                            "tournament_shift_id": None,
                            "role_id": _role(db, td_tournament.id, "Volunteer").id,
                        }
                    ],
                }
            ],
        )
        assert res.status_code == 200
        assert _marks(db, links) == {("day1", "member", VOL_DISCORD)}

    def test_zone_assignments_and_zone_delete(self, db, td, td_tournament, links, volunteer, day1):
        membership = grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        zone = TournamentZone(tournament_id=td_tournament.id, track_id=day1, name="North")
        db.add(zone)
        db.commit()
        _clear(db)
        res = td.post(
            f"/tournaments/{td_tournament.id}/zone-assignments/",
            json={
                "zone_id": zone.id,
                "membership_id": membership.id,
                "role_id": _role(db, td_tournament.id, "Runner").id,
            },
        )
        assert res.status_code == 201
        assert _marks(db, links) == {("day1", "member", VOL_DISCORD)}

        _clear(db)
        assert td.delete(f"/tournaments/{td_tournament.id}/zones/{zone.id}/").status_code == 204
        assert _marks(db, links) == {("day1", "member", VOL_DISCORD)}

    def test_deleting_a_shift_marks_the_staff_pinned_to_it(
        self, db, td, td_tournament, links, volunteer, event, day1
    ):
        membership = grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        start = datetime(2027, 4, 10, 15, tzinfo=UTC)
        shift = TournamentShift(
            tournament_id=td_tournament.id,
            track_id=day1,
            label="Block 1",
            start=start,
            end=start + timedelta(hours=2),
        )
        db.add(shift)
        db.flush()
        db.add(TournamentEventShift(tournament_event_id=event.id, tournament_shift_id=shift.id))
        db.add(
            TournamentTrackAssignment(
                membership_id=membership.id,
                role_id=_role(db, td_tournament.id, "Volunteer").id,
                tournament_track_id=day1,
                tournament_event_id=event.id,
                tournament_shift_id=shift.id,
            )
        )
        db.commit()
        _clear(db)
        assert td.delete(f"/tournaments/{td_tournament.id}/shifts/{shift.id}/").status_code == 204
        assert _marks(db, links) == {("day1", "member", VOL_DISCORD)}

    def test_marking_many_members_takes_the_same_few_queries(self, db, td_tournament, links, day1):
        memberships = [
            grant_role(db, td_tournament, _user(db, f"v{n}@test.com", 8100 + n), "Volunteer", day1)
            for n in range(6)
        ]
        _clear(db)
        tournament_id = td_tournament.id
        scopes = [(m.id, day1) for m in memberships]
        statements: list[str] = []
        bind = db.get_bind()

        def count(conn, cursor, statement, *args):
            if not statement.startswith("SAVEPOINT"):
                statements.append(statement)

        sa_event.listen(bind, "before_cursor_execute", count)
        try:
            mark_memberships(db, tournament_id, scopes)
        finally:
            sa_event.remove(bind, "before_cursor_execute", count)
        # Memberships, links, accounts, the upsert, and the notification.
        assert len(statements) == 5
        assert _marks(db, links) == {("day1", "member", 8100 + n) for n in range(6)}

    def test_unbuilt_servers_and_unlinked_users_get_no_marks(
        self, db, td, td_tournament, links, day1
    ):
        links["day1"].built_at = None
        db.commit()
        unlinked = _user(db, "nolink@test.com")
        linked = _user(db, "linked@test.com", 8002)
        for user in (unlinked, linked):
            grant_role(db, td_tournament, user, "Volunteer", track_id=day1)
        _clear(db)
        for user in (unlinked, linked):
            td.patch(
                f"/tournaments/{td_tournament.id}/members/"
                f"{_membership(db, td_tournament.id, user).id}/roles/",
                json={"add": [_role(db, td_tournament.id, "Runner").id], "track_id": day1},
            )
        assert _marks(db, links) == set()


class TestMemberships:
    def test_removing_a_member_marks_every_server(
        self, db, td, td_tournament, links, volunteer, day1
    ):
        membership = grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        _clear(db)
        res = td.delete(f"/tournaments/{td_tournament.id}/members/{membership.id}/")
        assert res.status_code == 204
        assert _marks(db, links) == {
            ("day1", "member", VOL_DISCORD),
            ("day2", "member", VOL_DISCORD),
        }

    def test_leaving_marks_every_server(self, db, client, td_tournament, links, volunteer, day1):
        grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        _clear(db)
        login(client, "vol@test.com", "pass1234")
        assert client.delete(f"/tournaments/{td_tournament.id}/members/me/").status_code == 204
        assert ("day2", "member", VOL_DISCORD) in _marks(db, links)

    def test_declining_age_disclosure_marks_every_server(
        self, db, client, td_tournament, links, volunteer, day1
    ):
        grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        _clear(db)
        login(client, "vol@test.com", "pass1234")
        url = f"/tournaments/{td_tournament.id}/members/me/age-disclosure/"
        assert client.post(url, json={"consent": True}).status_code == 200
        assert _marks(db, links) == set()
        # Declining removes the membership.
        assert client.post(url, json={"consent": False}).status_code == 200
        assert _marks(db, links) == {
            ("day1", "member", VOL_DISCORD),
            ("day2", "member", VOL_DISCORD),
        }

    def test_ownership_transfer_marks_both_owners(
        self, db, td, td_tournament, links, volunteer, day1
    ):
        grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        _clear(db)
        res = td.post(
            f"/tournaments/{td_tournament.id}/transfer-ownership/",
            json={"new_owner_id": volunteer.id},
        )
        assert res.status_code == 200
        assert _marks(db, links) == {
            (server, "member", account)
            for server in ("day1", "day2")
            for account in (TD_DISCORD, VOL_DISCORD)
        }


class TestRolesAndEvents:
    def test_role_create_and_rename_mark_structure(self, db, td, td_tournament, links):
        res = td.post(
            f"/tournaments/{td_tournament.id}/roles/",
            json={"label": "Photographer", "permissions": [], "rank": 60},
        )
        assert res.status_code == 201
        assert _marks(db, links) == {("day1", "structure", None), ("day2", "structure", None)}

        _clear(db)
        td.patch(
            f"/tournaments/{td_tournament.id}/roles/{res.json()['id']}/",
            json={"label": "Photos"},
        )
        assert _marks(db, links) == {("day1", "structure", None), ("day2", "structure", None)}

    def test_a_permission_change_waits_for_reset(self, db, td, td_tournament, links):
        role = _role(db, td_tournament.id, "Volunteer")
        td.patch(
            f"/tournaments/{td_tournament.id}/roles/{role.id}/",
            json={"permissions": ["manage_discord"]},
        )
        assert _marks(db, links) == set()

    def test_role_delete_marks_its_former_holders(
        self, db, td, td_tournament, links, volunteer, day1
    ):
        grant_role(db, td_tournament, volunteer, "Runner", track_id=day1)
        _clear(db)
        role = _role(db, td_tournament.id, "Runner")
        assert td.delete(f"/tournaments/{td_tournament.id}/roles/{role.id}/").status_code == 204
        assert _marks(db, links) == {
            ("day1", "structure", None),
            ("day2", "structure", None),
            ("day1", "member", VOL_DISCORD),
        }

    def test_event_create_rename_and_track_changes(self, db, td, td_tournament, links, day1):
        res = td.post(
            f"/tournaments/{td_tournament.id}/events/",
            json={
                "tournament_id": td_tournament.id,
                "name": "Boomilever",
                "division": "C",
                "track_details": [{"track_id": day1}],
            },
        )
        assert res.status_code == 201
        assert _marks(db, links) == {("day1", "structure", None), ("day2", "structure", None)}

        _clear(db)
        event_id = res.json()["id"]
        td.patch(f"/tournaments/{td_tournament.id}/events/{event_id}/", json={"name": "Boom"})
        assert ("day1", "structure", None) in _marks(db, links)

    def test_an_event_without_tracks_marks_nothing(self, db, td, td_tournament, links):
        td.post(
            f"/tournaments/{td_tournament.id}/events/",
            json={"tournament_id": td_tournament.id, "name": "Boomilever", "division": "C"},
        )
        assert _marks(db, links) == set()

    def test_removing_an_event_from_a_track_marks_its_staff(
        self, db, td, td_tournament, links, volunteer, event, day1
    ):
        membership = grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        db.add(
            TournamentTrackAssignment(
                membership_id=membership.id,
                role_id=_role(db, td_tournament.id, "Volunteer").id,
                tournament_track_id=day1,
                tournament_event_id=event.id,
            )
        )
        db.commit()
        _clear(db)
        res = td.patch(
            f"/tournaments/{td_tournament.id}/events/{event.id}/", json={"track_details": []}
        )
        assert res.status_code == 200
        assert ("day1", "member", VOL_DISCORD) in _marks(db, links)
        assert ("day1", "structure", None) in _marks(db, links)

    def test_event_delete_marks_its_staff(
        self, db, td, td_tournament, links, volunteer, event, day1
    ):
        membership = grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        db.add(
            TournamentTrackAssignment(
                membership_id=membership.id,
                role_id=_role(db, td_tournament.id, "Volunteer").id,
                tournament_track_id=day1,
                tournament_event_id=event.id,
            )
        )
        db.commit()
        _clear(db)
        assert td.delete(f"/tournaments/{td_tournament.id}/events/{event.id}/").status_code == 204
        assert _marks(db, links) == {
            ("day1", "structure", None),
            ("day2", "structure", None),
            ("day1", "member", VOL_DISCORD),
        }


class TestCatchUp:
    def test_unarchiving_marks_every_server_full(self, db, td, td_tournament, links):
        td_tournament.is_archived = True
        db.commit()
        assert td.post(f"/tournaments/{td_tournament.id}/unarchive/").status_code == 200
        assert _marks(db, links) == {("day1", "full", None), ("day2", "full", None)}

    def test_cancelling_a_track_deletion_marks_that_server_full(
        self, db, td, td_tournament, links, day2
    ):
        db.get(TournamentTrack, day2).is_archived = True
        db.commit()
        res = td.post(f"/tournaments/{td_tournament.id}/tracks/{day2}/restore/")
        assert res.status_code == 200
        assert _marks(db, links) == {("day2", "full", None)}


class TestAccounts:
    def test_unlinking_marks_the_old_account(
        self, db, client, td_tournament, links, volunteer, day1
    ):
        grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        _clear(db)
        login(client, "vol@test.com", "pass1234")
        assert client.delete("/users/me/identities/discord/").status_code == 200
        assert _marks(db, links) == {("day1", "member", VOL_DISCORD)}

    def test_owners_are_marked_in_every_server(self, db, client, td_user, links):
        login(client, "td@test.com", "tdpass")
        assert client.delete("/users/me/identities/discord/").status_code == 200
        assert _marks(db, links) == {
            ("day1", "member", TD_DISCORD),
            ("day2", "member", TD_DISCORD),
        }

    def test_deleting_an_account_marks_it_first(
        self, db, client, td_tournament, links, volunteer, day1
    ):
        grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        _clear(db)
        login(client, "vol@test.com", "pass1234")
        res = client.request("DELETE", "/users/me/", json={"password": "pass1234"})
        assert res.status_code == 200
        assert _marks(db, links) == {("day1", "member", VOL_DISCORD)}

    def test_deactivating_marks_the_account(
        self, db, client, td_tournament, links, volunteer, day1
    ):
        grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        _clear(db)
        login(client, "vol@test.com", "pass1234")
        res = client.post("/users/me/deactivate/", json={"password": "pass1234"})
        assert res.status_code == 200
        assert _marks(db, links) == {("day1", "member", VOL_DISCORD)}

    def test_a_name_change_marks_the_account_when_the_nickname_changes(
        self, db, client, td_tournament, links, volunteer, day1
    ):
        grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        _clear(db)
        login(client, "vol@test.com", "pass1234")
        for unchanged in ({"pronouns": "they/them"}, {"last_name": "Evans"}):
            assert client.patch("/users/me/", json=unchanged).status_code == 200
            assert _marks(db, links) == set()
        assert client.patch("/users/me/", json={"first_name": "Sam"}).status_code == 200
        assert _marks(db, links) == {("day1", "member", VOL_DISCORD)}

    def test_an_admin_locking_or_deleting_a_user_marks_them(
        self, db, client, admin_user, td_tournament, links, volunteer, day1
    ):
        grant_role(db, td_tournament, volunteer, "Volunteer", track_id=day1)
        _clear(db)
        login(client, "admin@test.com", "adminpass")
        res = client.patch(f"/admin/users/{volunteer.id}/", json={"status": "locked"})
        assert res.status_code == 200
        assert _marks(db, links) == {("day1", "member", VOL_DISCORD)}

        _clear(db)
        assert client.delete(f"/admin/users/{volunteer.id}/").status_code == 204
        assert _marks(db, links) == {("day1", "member", VOL_DISCORD)}


class TestConflictsStillReport409:
    """Marking runs queries, which autoflush the write; a duplicate must still be a 409."""

    def test_renaming_into_a_duplicate_catalog_event(
        self, db, td, td_tournament, links, day1, event_factory, event_category
    ):
        catalog = event_factory(event_category)
        events_url = f"/tournaments/{td_tournament.id}/events/"
        td.post(
            events_url,
            json={"tournament_id": td_tournament.id, "event_id": catalog.id, "division": "C"},
        )
        other = td.post(
            events_url,
            json={"tournament_id": td_tournament.id, "event_id": catalog.id, "division": "B"},
        ).json()
        res = td.patch(f"{events_url}{other['id']}/", json={"division": "C"})
        assert res.status_code == 409
