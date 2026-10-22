"""The sync: marks claimed by the drain and reconciled against the in-memory Discord server, after
a real build of the shared test server (tests/core/conftest.py)."""

from datetime import timedelta

import pytest
from sqlalchemy import event as sa_event

from app.core.discord import events as gateway_events
from app.core.discord.build import claim_build, run_build
from app.core.discord.drain import Syncer, claim_marks
from app.core.discord.marks import mark_full, mark_member, mark_structure
from app.core.discord.sweep import mark_all_full
from app.models.discord import (
    DiscordGuildLink,
    DiscordManagedChannel,
    DiscordManagedRole,
    DiscordSyncMark,
)
from app.models.models import (
    Event,
    EventCategory,
    OAuthIdentity,
    OAuthProvider,
    TournamentEvent,
    TournamentEventTrack,
    TournamentRole,
    TournamentTrack,
    TournamentTrackAssignment,
    User,
    utcnow,
)
from app.services.discord.permissions import POSTING, STAFF_OVERWRITE, VIEW_CHANNEL
from app.services.discord.rest import GUILD_CATEGORY, ROLE_OVERWRITE
from tests.conftest import grant_role
from tests.core.conftest import GUILD_ID

TD_DISCORD = 6000


def _user(db, email: str, discord_id: int | None = None) -> User:
    user = User(email=email, first_name="Pat", last_name=email.split("@")[0], status="active")
    db.add(user)
    db.flush()
    if discord_id is not None:
        db.add(
            OAuthIdentity(
                user_id=user.id,
                provider=OAuthProvider.discord,
                provider_account_id=str(discord_id),
            )
        )
    db.commit()
    return user


def _role(db, tournament_id: int, label: str) -> TournamentRole:
    return db.query(TournamentRole).filter_by(tournament_id=tournament_id, label=label).one()


def _staff_event(db, tournament, user, label: str, track_id: int, event: TournamentEvent):
    membership = grant_role(db, tournament, user, label, track_id=track_id)
    db.add(
        TournamentTrackAssignment(
            membership_id=membership.id,
            role_id=_role(db, tournament.id, label).id,
            tournament_track_id=track_id,
            tournament_event_id=event.id,
        )
    )
    db.commit()
    return membership


@pytest.fixture
async def built(db, link, guild, scope, td_user):
    """The test server built, with the TD's Discord account linked and in the server."""
    db.add(
        OAuthIdentity(
            user_id=td_user.id, provider=OAuthProvider.discord, provider_account_id=str(TD_DISCORD)
        )
    )
    db.commit()
    guild.join(TD_DISCORD)
    assert claim_build(db, link.id)
    assert await run_build(link.id, reset=False, target=None, session_scope=scope) is None
    db.refresh(link)
    await _sync(scope)
    return link


async def _sync(scope):
    await Syncer(scope).run_pending()


def _marks(db, link_id: int | None = None) -> list[tuple[str, int | None]]:
    query = db.query(DiscordSyncMark)
    if link_id is not None:
        query = query.filter_by(link_id=link_id)
    return sorted((m.kind, m.discord_user_id) for m in query)


class TestMembers:
    async def test_the_owner_gets_tournament_owner_and_their_roles(self, built, guild):
        assert guild.member_role_names(TD_DISCORD) == {
            "Tournament Owner",
            "Tournament Director",
            "Verified",
        }

    async def test_event_staff_get_their_event_role(
        self, db, built, guild, scope, td_tournament, track_id, events
    ):
        volunteer = _user(db, "vol@test.com", 6001)
        mods = guild.add_role("Mods")
        guild.join(6001, mods)
        _staff_event(db, td_tournament, volunteer, "Runner", track_id, events["Anatomy C"])
        mark_member(db, built.id, 6001)
        db.commit()
        await _sync(scope)
        assert guild.member_role_names(6001) == {"Verified", "Runner", "Anatomy C", "Mods"}
        assert _marks(db) == []

    async def test_a_tournament_wide_role_counts(self, db, built, guild, scope, td_tournament):
        coordinator = _user(db, "vc@test.com", 6002)
        guild.join(6002)
        grant_role(db, td_tournament, coordinator, "Volunteer Coordinator")
        mark_member(db, built.id, 6002)
        db.commit()
        await _sync(scope)
        assert guild.member_role_names(6002) == {"Verified", "Volunteer Coordinator"}

    async def test_rows_on_other_tracks_dont_count(self, db, built, guild, scope, td_tournament):
        writer = _user(db, "writer@test.com", 6003)
        guild.join(6003)
        other = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
        db.add(other)
        db.commit()
        grant_role(db, td_tournament, writer, "Test Writer", track_id=other.id)
        mark_member(db, built.id, 6003)
        db.commit()
        await _sync(scope)
        assert guild.member_role_names(6003) == set()

    async def test_ineligible_members_are_stripped_not_kicked(
        self, db, built, guild, scope, mock_discord_rest
    ):
        _user(db, "nobody@test.com", 6004)
        mods = guild.add_role("Mods")
        guild.join(6004, mods, int(guild.role("Verified")["id"]), int(guild.role("Runner")["id"]))
        guild.join(6005, int(guild.role("Verified")["id"]))
        mark_full(db, built.id)
        db.commit()
        await _sync(scope)
        assert guild.member_role_names(6004) == {"Mods"}
        assert guild.member_role_names(6005) == set()
        assert 6004 in guild.members and 6005 in guild.members

    async def test_deactivated_users_lose_their_roles(self, db, built, guild, scope, td_user):
        td_user.status = "deactivated"
        mark_member(db, built.id, TD_DISCORD)
        db.commit()
        await _sync(scope)
        assert guild.member_role_names(TD_DISCORD) == set()

    async def test_bots_are_never_touched(self, db, built, guild, scope, mock_discord_rest):
        guild.join(6006, int(guild.role("Verified")["id"]), bot=True)
        mark_full(db, built.id)
        db.commit()
        await _sync(scope)
        assert guild.member_role_names(6006) == {"Verified"}

    async def test_members_not_in_the_server_are_skipped(self, db, built, scope):
        _user(db, "away@test.com", 6007)
        mark_member(db, built.id, 6007)
        db.commit()
        await _sync(scope)
        assert _marks(db) == []

    async def test_a_role_above_the_bot_is_skipped_and_reported(
        self, db, built, guild, scope, td_tournament
    ):
        volunteer = _user(db, "vol@test.com", 6008)
        guild.join(6008)
        grant_role(db, td_tournament, volunteer, "Runner", track_id=built.track_id)
        top = max(int(r["position"]) for r in guild.roles.values())
        guild.role("Runner")["position"] = top + 1
        mark_member(db, built.id, 6008)
        db.commit()
        await _sync(scope)
        assert guild.member_role_names(6008) == {"Verified"}
        db.refresh(built)
        # The rest synced, so it's a warning, not a failure.
        assert built.last_sync_error is None
        assert built.last_sync_warning == (
            "Move lobot's role above Runner. lobot can't give or remove it."
        )
        assert _marks(db) == []

        # Moved back below the bot, the next full sync assigns it and clears the warning.
        guild.role("Runner")["position"] = 1
        mark_full(db, built.id)
        db.commit()
        await _sync(scope)
        db.refresh(built)
        assert "Runner" in guild.member_role_names(6008)
        assert built.last_sync_warning is None

    async def test_a_full_sync_with_nothing_out_of_place_writes_nothing(
        self, db, built, scope, mock_discord_rest
    ):
        mock_discord_rest.writes.clear()
        mark_full(db, built.id)
        db.commit()
        await _sync(scope)
        assert [kind for kind, _ in mock_discord_rest.writes] == ["list_members"]

    async def test_a_full_sync_reads_assignments_in_one_query(
        self, db, built, guild, scope, td_tournament
    ):
        for n in range(5):
            user = _user(db, f"v{n}@test.com", 6100 + n)
            guild.join(6100 + n)
            grant_role(db, td_tournament, user, "Runner", track_id=built.track_id)
        statements = []
        bind = db.get_bind()

        def count(conn, cursor, statement, *args):
            if "tournament_track_assignments" in statement and "oauth" not in statement:
                statements.append(statement)

        sa_event.listen(bind, "before_cursor_execute", count)
        try:
            mark_full(db, built.id)
            db.commit()
            statements.clear()
            await _sync(scope)
        finally:
            sa_event.remove(bind, "before_cursor_execute", count)
        assert {guild.member_role_names(6100 + n) == {"Verified", "Runner"} for n in range(5)} == {
            True
        }
        member_queries = [s for s in statements if "tournament_memberships" in s]
        assert len(member_queries) == 1


class TestNicknames:
    async def test_eligible_members_get_their_nexus_name(self, built, guild):
        assert guild.nicks[TD_DISCORD] == "TD U."

    async def test_the_sweep_puts_back_a_hand_edited_nickname(self, db, built, guild, scope):
        guild.nicks[TD_DISCORD] = "Boss"
        mark_all_full(db)
        await _sync(scope)
        assert guild.nicks[TD_DISCORD] == "TD U."

    async def test_ineligible_and_unlinked_members_keep_theirs(self, db, built, guild, scope):
        _user(db, "nobody@test.com", 6004)
        guild.join(6004, nick="Nobody")
        guild.join(6005, nick="Stranger")
        mark_full(db, built.id)
        db.commit()
        await _sync(scope)
        assert (guild.nicks[6004], guild.nicks[6005]) == ("Nobody", "Stranger")

    async def test_a_user_without_a_first_name_keeps_theirs(self, db, built, guild, scope, td_user):
        td_user.first_name = None
        guild.nicks[TD_DISCORD] = "Boss"
        mark_member(db, built.id, TD_DISCORD)
        db.commit()
        await _sync(scope)
        assert guild.nicks[TD_DISCORD] == "Boss"

    async def test_a_refused_nickname_doesnt_fail_the_sync(
        self, db, built, guild, scope, td_tournament
    ):
        volunteer = _user(db, "vol@test.com", 6009)
        guild.join(6009)
        grant_role(db, td_tournament, volunteer, "Runner", track_id=built.track_id)
        guild.refused_nicks.add("TD U.")
        guild.nicks[TD_DISCORD] = "Boss"
        mark_full(db, built.id)
        db.commit()
        await _sync(scope)
        db.refresh(built)
        assert guild.nicks[TD_DISCORD] == "Boss"
        assert guild.nicks[6009] == "Pat V."
        assert built.last_sync_error is None
        assert _marks(db) == []

    async def test_the_server_owner_is_skipped(self, db, built, guild, scope):
        guild.owner_id = TD_DISCORD
        guild.nicks[TD_DISCORD] = "Owner"
        mark_full(db, built.id)
        db.commit()
        await _sync(scope)
        db.refresh(built)
        assert guild.nicks[TD_DISCORD] == "Owner"
        assert built.last_sync_error is None

    async def test_members_with_a_role_above_the_bot_are_skipped(
        self, db, built, guild, scope, td_tournament
    ):
        volunteer = _user(db, "vol@test.com", 6008)
        founders = guild.add_role("Founders", top=True)
        guild.join(6008, founders, nick="Founder")
        grant_role(db, td_tournament, volunteer, "Runner", track_id=built.track_id)
        mark_member(db, built.id, 6008)
        db.commit()
        await _sync(scope)
        db.refresh(built)
        assert guild.nicks[6008] == "Founder"
        assert guild.member_role_names(6008) == {"Founders", "Verified", "Runner"}
        assert built.last_sync_error is None


class TestStructure:
    async def _full(self, db, link, scope):
        mark_full(db, link.id)
        db.commit()
        await _sync(scope)
        db.refresh(link)

    async def test_a_deleted_managed_role_comes_back_to_its_holders(
        self, db, built, guild, scope, mock_discord_rest, td_tournament
    ):
        volunteer = _user(db, "vol@test.com", 6010)
        guild.join(6010)
        grant_role(db, td_tournament, volunteer, "Runner", track_id=built.track_id)
        await self._full(db, built, scope)
        old = int(guild.role("Runner")["id"])
        await mock_discord_rest.delete_role(GUILD_ID, old)
        gateway_events.role_deleted(db, GUILD_ID, old)
        assert _marks(db) == [("full", None)]
        await _sync(scope)
        assert int(guild.role("Runner")["id"]) != old
        assert "Runner" in guild.member_role_names(6010)

    async def test_a_renamed_managed_role_is_renamed_back(self, db, built, guild, scope):
        guild.role("Runner")["name"] = "Runners!"
        await self._full(db, built, scope)
        assert guild.role("Runner")

    async def test_a_deleted_nexus_role_deletes_its_discord_role(
        self, db, built, guild, scope, td_tournament
    ):
        runner = _role(db, td_tournament.id, "Runner")
        discord_id = int(guild.role("Runner")["id"])
        db.delete(runner)
        mark_structure(db, built.id)
        db.commit()
        await _sync(scope)
        assert discord_id not in guild.roles
        assert db.query(DiscordManagedRole).filter_by(discord_role_id=discord_id).count() == 0

    async def test_a_new_event_gets_a_role_and_a_channel(
        self, db, built, guild, scope, td_tournament, track_id, events
    ):
        building = events["Circuit Lab B"].track_details[0].building_id
        boom = TournamentEvent(tournament_id=td_tournament.id, name="Boomilever", division="C")
        db.add(boom)
        db.flush()
        db.add(
            TournamentEventTrack(
                tournament_event_id=boom.id, track_id=track_id, building_id=building
            )
        )
        mark_structure(db, built.id)
        db.commit()
        await _sync(scope)
        role = int(guild.role("Boomilever C")["id"])
        channel = guild.channel("boomilever-c")
        rowland = guild.channel("Rowland Hall", GUILD_CATEGORY)
        assert channel["parent_id"] == rowland["id"]
        assert guild.overwrite(channel, role) == (VIEW_CHANNEL, 0)
        assert guild.overwrite(channel, GUILD_ID) == (0, VIEW_CHANNEL)

    async def test_a_deleted_event_archives_its_channel(self, db, built, guild, scope, events):
        anatomy = events["Anatomy C"]
        channel = guild.channel("anatomy-c")
        db.delete(anatomy)
        mark_structure(db, built.id)
        db.commit()
        await _sync(scope)
        archived = guild.channel("Archived", GUILD_CATEGORY)
        assert channel["parent_id"] == archived["id"]
        assert guild.overwrite(archived, int(guild.role("Volunteer Coordinator")["id"])) == (
            STAFF_OVERWRITE,
            0,
        )
        assert [r["name"] for r in guild.roles.values() if r["name"] == "Anatomy C"] == []
        row = db.query(DiscordManagedChannel).filter_by(link_id=built.id, key=f"event:{anatomy.id}")
        assert row.one().archived is True
        # Unmanaged now: deleting it again recreates nothing.
        del guild.channels[int(channel["id"])]
        await self._full(db, built, scope)
        assert not [c for c in guild.channels.values() if c["name"] == "anatomy-c"]

    async def test_a_deleted_managed_channel_is_recreated(self, db, built, guild, scope, events):
        old = guild.channel("circuit-lab-b")
        del guild.channels[int(old["id"])]
        gateway_events.channel_deleted(db, GUILD_ID, int(old["id"]))
        assert _marks(db) == [("structure", None)]
        await _sync(scope)
        new = guild.channel("circuit-lab-b")
        assert new["parent_id"] == guild.channel("Rowland Hall", GUILD_CATEGORY)["id"]
        role = int(guild.role("Circuit Lab B")["id"])
        assert guild.overwrite(new, role) == (VIEW_CHANNEL, 0)

    async def test_a_deleted_category_comes_back_with_its_channels(self, db, built, guild, scope):
        category = guild.channel("Rowland Hall", GUILD_CATEGORY)
        del guild.channels[int(category["id"])]
        for channel in guild.channels.values():
            if channel["parent_id"] == category["id"]:
                channel["parent_id"] = None
        await self._full(db, built, scope)
        new = guild.channel("Rowland Hall", GUILD_CATEGORY)
        assert sorted(guild.children(new)) == ["circuit-lab-b", "circuit-lab-c"]

    async def test_a_deleted_fixed_channel_comes_back_read_only(self, db, built, guild, scope):
        old = guild.channel("announcements")
        del guild.channels[int(old["id"])]
        await self._full(db, built, scope)
        new = guild.channel("announcements")
        assert new["parent_id"] == guild.channel("Information", GUILD_CATEGORY)["id"]
        staff = int(guild.role("Volunteer Coordinator")["id"])
        assert guild.overwrite(new, GUILD_ID) == (0, POSTING)
        assert guild.overwrite(new, staff) == (STAFF_OVERWRITE | POSTING, 0)

    async def test_a_deleted_fixed_category_comes_back_with_its_channels(
        self, db, built, guild, scope
    ):
        category = guild.channel("Volunteers", GUILD_CATEGORY)
        del guild.channels[int(category["id"])]
        for channel in guild.channels.values():
            if channel["parent_id"] == category["id"]:
                channel["parent_id"] = None
        await self._full(db, built, scope)
        new = guild.channel("Volunteers", GUILD_CATEGORY)
        assert sorted(guild.children(new)) == ["general", "random"]

    async def test_a_staff_overwrite_comes_back_with_posting_in_information(
        self, db, built, guild, scope, mock_discord_rest
    ):
        staff = int(guild.role("Volunteer Coordinator")["id"])
        links = guild.channel("useful-links")
        await mock_discord_rest.delete_overwrite(int(links["id"]), staff)
        await self._full(db, built, scope)
        assert guild.overwrite(links, staff) == (STAFF_OVERWRITE | POSTING, 0)

    async def test_verify_and_its_message_come_back(
        self, db, built, guild, scope, mock_discord_rest
    ):
        verify = guild.channel("verify")
        del guild.channels[int(verify["id"])]
        await self._full(db, built, scope)
        new = guild.channel("verify")
        assert new["id"] != verify["id"]
        assert int(new["id"]) in mock_discord_rest.messages
        assert built.verify_channel_id == int(new["id"])

    async def test_staff_overwrites_on_admin_channels(
        self, db, built, guild, scope, mock_discord_rest
    ):
        vc = int(guild.role("Volunteer Coordinator")["id"])
        channel_id = guild.add_channel("off-topic")
        gateway_events.channel_created(db, GUILD_ID)
        await _sync(scope)
        assert guild.overwrite(guild.channels[channel_id], vc) == (STAFF_OVERWRITE, 0)

        # An explicit deny hides it from staff, and stays.
        await mock_discord_rest.put_overwrite(
            channel_id, vc, allow=0, deny=VIEW_CHANNEL, type=ROLE_OVERWRITE
        )
        await self._full(db, built, scope)
        assert guild.overwrite(guild.channels[channel_id], vc) == (0, VIEW_CHANNEL)

        # Removing the role from the list entirely counts as no choice; the allow comes back.
        await mock_discord_rest.delete_overwrite(channel_id, vc)
        gateway_events.role_overwrites_removed(db, GUILD_ID, {vc})
        await _sync(scope)
        assert guild.overwrite(guild.channels[channel_id], vc) == (STAFF_OVERWRITE, 0)

    async def test_configuration_waits_for_reset(self, db, built, guild, scope):
        guild.role("Runner")["permissions"] = str(VIEW_CHANNEL)
        channel = guild.channel("circuit-lab-b")
        channel["name"] = "circuits"
        everyone = next(o for o in channel["permission_overwrites"] if int(o["id"]) == GUILD_ID)
        everyone["deny"] = "0"
        await self._full(db, built, scope)
        assert guild.role("Runner")["permissions"] == str(VIEW_CHANNEL)
        assert channel["name"] == "circuits"
        assert guild.overwrite(channel, GUILD_ID) == (0, 0)

    async def test_a_role_set_up_as_the_sync_would_create_it_is_adopted(
        self, db, built, guild, scope, mock_discord_rest, td_tournament
    ):
        volunteer = _user(db, "vol@test.com", 6011)
        guild.join(6011)
        grant_role(db, td_tournament, volunteer, "Runner", track_id=built.track_id)
        old = guild.role("Runner")
        await mock_discord_rest.delete_role(GUILD_ID, int(old["id"]))
        # As a create that timed out after Discord made the role leaves it.
        orphan = guild.add_role("Runner", int(old["permissions"]))
        mock_discord_rest.writes.clear()
        await self._full(db, built, scope)
        assert int(guild.role("Runner")["id"]) == orphan
        assert "Runner" in guild.member_role_names(6011)
        assert "create_role" not in [kind for kind, _ in mock_discord_rest.writes]
        assert db.query(DiscordManagedRole).filter_by(discord_role_id=orphan).count() == 1

    async def test_a_role_with_other_permissions_isnt_adopted(
        self, db, built, guild, scope, mock_discord_rest
    ):
        old = guild.role("Runner")
        await mock_discord_rest.delete_role(GUILD_ID, int(old["id"]))
        admins = guild.add_role("Runner", int(old["permissions"]) | VIEW_CHANNEL)
        await self._full(db, built, scope)
        runners = [r for r in guild.roles.values() if r["name"] == "Runner"]
        assert len(runners) == 2
        assert guild.roles[admins]["permissions"] == str(int(old["permissions"]) | VIEW_CHANNEL)
        assert db.query(DiscordManagedRole).filter_by(discord_role_id=admins).count() == 0

    async def test_a_channel_set_up_as_the_sync_would_create_it_is_adopted(
        self, db, built, guild, scope, mock_discord_rest
    ):
        old = guild.channel("circuit-lab-b")
        del guild.channels[int(old["id"])]
        orphan = guild.add_channel(
            "circuit-lab-b",
            parent_id=int(old["parent_id"]),
            overwrites=[dict(o) for o in old["permission_overwrites"]],
        )
        mock_discord_rest.writes.clear()
        await self._full(db, built, scope)
        assert int(guild.channel("circuit-lab-b")["id"]) == orphan
        assert "create_channel" not in [kind for kind, _ in mock_discord_rest.writes]
        assert db.query(DiscordManagedChannel).filter_by(discord_channel_id=orphan).count() == 1

    async def test_a_channel_set_up_differently_isnt_adopted(self, db, built, guild, scope):
        old = guild.channel("circuit-lab-b")
        del guild.channels[int(old["id"])]
        admins = guild.add_channel("circuit-lab-b")
        await self._full(db, built, scope)
        names = [c["name"] for c in guild.channels.values()]
        assert names.count("circuit-lab-b") == 2
        assert guild.channels[admins]["parent_id"] is None
        assert db.query(DiscordManagedChannel).filter_by(discord_channel_id=admins).count() == 0

    async def test_an_adopted_category_takes_back_its_channels(
        self, db, built, guild, scope, mock_discord_rest
    ):
        old = guild.channel("Rowland Hall", GUILD_CATEGORY)
        del guild.channels[int(old["id"])]
        for channel in guild.channels.values():
            if channel["parent_id"] == old["id"]:
                channel["parent_id"] = None
        orphan = guild.add_channel(
            "Rowland Hall",
            GUILD_CATEGORY,
            overwrites=[dict(o) for o in old["permission_overwrites"]],
        )
        mock_discord_rest.writes.clear()
        await self._full(db, built, scope)
        assert int(guild.channel("Rowland Hall", GUILD_CATEGORY)["id"]) == orphan
        assert sorted(guild.children(guild.channels[orphan])) == ["circuit-lab-b", "circuit-lab-c"]
        assert "create_channel" not in [kind for kind, _ in mock_discord_rest.writes]


class TestMergedChannels:
    @pytest.fixture
    async def merged(self, db, link, guild, scope, td_tournament, events):
        category = EventCategory(name="Lab")
        db.add(category)
        db.flush()
        catalog = Event(name="Circuit Lab", category_id=category.id)
        db.add(catalog)
        db.flush()
        for name in ("Circuit Lab B", "Circuit Lab C"):
            events[name].event_id = catalog.id
        link.merge_divisions = True
        db.commit()
        assert claim_build(db, link.id)
        assert await run_build(link.id, reset=False, target=None, session_scope=scope) is None
        await _sync(scope)
        return catalog

    async def test_a_new_division_joins_the_merged_channel(
        self, db, link, guild, scope, td_tournament, track_id, events, merged
    ):
        building = events["Circuit Lab B"].track_details[0].building_id
        a = TournamentEvent(
            tournament_id=td_tournament.id, name="Circuit Lab", division="A", event_id=merged.id
        )
        db.add(a)
        db.flush()
        db.add(
            TournamentEventTrack(tournament_event_id=a.id, track_id=track_id, building_id=building)
        )
        mark_structure(db, link.id)
        db.commit()
        await _sync(scope)
        channel = guild.channel("circuit-lab-bc")
        assert guild.overwrite(channel, int(guild.role("Circuit Lab A")["id"])) == (VIEW_CHANNEL, 0)
        ids = sorted([a.id, events["Circuit Lab B"].id, events["Circuit Lab C"].id])
        keys = {c.key for c in db.query(DiscordManagedChannel).filter_by(archived=False)}
        assert f"event:{','.join(map(str, ids))}" in keys
        assert not [c for c in guild.channels.values() if c["name"].startswith("circuit-lab-a")]

    async def test_one_event_leaving_keeps_the_channel(
        self, db, link, guild, scope, events, merged
    ):
        channel = guild.channel("circuit-lab-bc")
        db.delete(events["Circuit Lab B"])
        mark_structure(db, link.id)
        db.commit()
        await _sync(scope)
        assert channel["parent_id"] == guild.channel("Rowland Hall", GUILD_CATEGORY)["id"]
        keys = {c.key for c in db.query(DiscordManagedChannel).filter_by(archived=False)}
        assert f"event:{events['Circuit Lab C'].id}" in keys


class TestDrain:
    async def test_duplicate_marks_merge(self, db, built):
        mark_member(db, built.id, 1)
        mark_member(db, built.id, 1)
        mark_structure(db, built.id)
        mark_structure(db, built.id)
        db.commit()
        assert _marks(db) == [("member", 1), ("structure", None)]

    async def test_a_mark_rewritten_during_a_reconcile_survives_it(self, db, built):
        mark_member(db, built.id, 1)
        db.commit()
        claimed_at, by_link = claim_marks(db)
        mark_member(db, built.id, 1)
        db.commit()
        from app.core.discord.drain import _settle

        _settle(db, [m.id for m in by_link[built.id]], claimed_at)
        db.commit()
        assert _marks(db) == [("member", 1)]

    async def test_skipped_links_drop_their_marks_without_calling_discord(
        self, db, built, scope, td_tournament, mock_discord_rest
    ):
        td_tournament.is_archived = True
        mark_full(db, built.id)
        db.commit()
        mock_discord_rest.writes.clear()
        await _sync(scope)
        assert _marks(db) == []
        assert mock_discord_rest.writes == []

    async def test_a_running_build_holds_marks_back(self, db, built, scope):
        built.last_build_status = "running"
        built.last_build_at = utcnow()
        mark_full(db, built.id)
        db.commit()
        await _sync(scope)
        [mark] = db.query(DiscordSyncMark).all()
        assert mark.next_attempt_at > utcnow()
        assert mark.attempts == 0

    async def test_a_build_cant_start_while_the_sync_changes_the_server(
        self, db, built, guild, scope, mock_discord_rest, monkeypatch
    ):
        claims: list[bool] = []
        create_role = mock_discord_rest.create_role

        async def create_while_a_build_tries_to_start(*args, **kwargs):
            claims.append(claim_build(db, built.id))
            return await create_role(*args, **kwargs)

        monkeypatch.setattr(mock_discord_rest, "create_role", create_while_a_build_tries_to_start)
        await mock_discord_rest.delete_role(GUILD_ID, int(guild.role("Verified")["id"]))
        mark_structure(db, built.id)
        db.commit()
        await _sync(scope)
        assert claims == [False]
        db.refresh(built)
        assert built.sync_started_at is None
        assert claim_build(db, built.id)

    async def test_a_build_that_started_first_holds_the_structure_sync_back(
        self, db, built, scope, monkeypatch
    ):
        from app.core.discord import drain

        # The build claims the link after the sync's first look found it idle.
        monkeypatch.setattr(drain, "_link_state", lambda db, link_id: "sync")
        assert claim_build(db, built.id)
        mark_structure(db, built.id)
        db.commit()
        await _sync(scope)
        [mark] = db.query(DiscordSyncMark).all()
        assert mark.next_attempt_at > utcnow()
        assert mark.attempts == 0
        db.refresh(built)
        assert built.sync_started_at is None

    async def test_failures_back_off_and_are_reported(
        self, db, built, scope, mock_discord_rest, monkeypatch
    ):
        async def broken(guild_id, user_id):
            raise RuntimeError("Discord is down")

        working = mock_discord_rest.member
        monkeypatch.setattr(mock_discord_rest, "member", broken)
        mark_member(db, built.id, TD_DISCORD)
        db.commit()
        await _sync(scope)
        [mark] = db.query(DiscordSyncMark).all()
        assert mark.attempts == 1
        assert mark.next_attempt_at > utcnow() + timedelta(seconds=3)
        db.refresh(built)
        assert built.last_sync_error == "Discord is down"

        # A later success clears the error.
        monkeypatch.setattr(mock_discord_rest, "member", working)
        mark.next_attempt_at = utcnow()
        mark_full(db, built.id)
        db.commit()
        await _sync(scope)
        db.refresh(built)
        assert built.last_sync_error is None
        assert _marks(db) == []

    async def test_a_member_sync_clears_the_error_once_nothing_is_retrying(
        self, db, built, scope, mock_discord_rest, monkeypatch
    ):
        async def broken(guild_id, user_id):
            raise RuntimeError("Discord is down")

        working = mock_discord_rest.member
        monkeypatch.setattr(mock_discord_rest, "member", broken)
        mark_member(db, built.id, TD_DISCORD)
        mark_member(db, built.id, 7002)
        db.commit()
        await _sync(scope)
        monkeypatch.setattr(mock_discord_rest, "member", working)

        # One retry succeeds while the other is still backing off: the error stays.
        first, second = db.query(DiscordSyncMark).order_by(DiscordSyncMark.id).all()
        first.next_attempt_at = utcnow()
        db.commit()
        await _sync(scope)
        db.refresh(built)
        assert built.last_sync_error == "Discord is down"

        second.next_attempt_at = utcnow()
        db.commit()
        await _sync(scope)
        db.refresh(built)
        assert built.last_sync_error is None
        assert _marks(db) == []


class TestGatewayEvents:
    async def test_member_join_marks_the_member(self, db, built):
        gateway_events.member_joined(db, GUILD_ID, 7001)
        assert _marks(db) == [("member", 7001)]

    async def test_servers_that_dont_sync_are_ignored(self, db, link):
        gateway_events.member_joined(db, GUILD_ID, 7001)
        gateway_events.channel_created(db, GUILD_ID)
        gateway_events.member_joined(db, 9999, 7001)
        assert _marks(db) == []

    async def test_unmanaged_roles_and_channels_are_ignored(self, db, built, guild):
        mods = guild.add_role("Mods")
        gateway_events.role_deleted(db, GUILD_ID, mods)
        gateway_events.channel_deleted(db, GUILD_ID, guild.add_channel("chat"))
        gateway_events.role_overwrites_removed(db, GUILD_ID, {mods})
        assert _marks(db) == []

    async def test_a_server_marked_by_the_sweep(self, db, built, td_tournament):
        unbuilt = DiscordGuildLink(
            tournament_id=td_tournament.id,
            track_id=_other_track(db, td_tournament).id,
            guild_id=GUILD_ID + 1,
        )
        db.add(unbuilt)
        db.commit()
        mark_all_full(db)
        assert _marks(db, built.id) == [("full", None)]
        assert _marks(db, unbuilt.id) == []


def _other_track(db, tournament) -> TournamentTrack:
    track = TournamentTrack(tournament_id=tournament.id, name="Day 2")
    db.add(track)
    db.commit()
    return track
