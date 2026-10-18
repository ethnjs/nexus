"""build() against the in-memory Discord server, with real NEXUS data in the test database."""

from datetime import timedelta

import pytest

from app.core.discord.build import (
    GATE_NOTICE,
    VOLUNTEER_GUIDE_URL,
    Target,
    claim_build,
    parse_roles,
    prepare,
    ranked_roles,
    run_build,
)
from app.models.discord import (
    DiscordManagedChannel,
    DiscordManagedRole,
    DiscordSyncMark,
)
from app.models.models import (
    Event,
    EventCategory,
    TournamentEvent,
    TournamentRole,
    utcnow,
)
from app.services.discord.permissions import (
    ADMINISTRATOR,
    READ_MESSAGE_HISTORY,
    SEND_MESSAGES,
    STAFF_OVERWRITE,
    STAFF_PERMISSIONS,
    VIEW_CHANNEL,
)
from app.services.discord.rest import GUILD_CATEGORY, MEMBER_OVERWRITE, ROLE_OVERWRITE
from tests.core.conftest import GUILD_ID


async def _preview(link, scope, *, reset=False, target=None):
    plan, _, _ = await prepare(link.id, reset=reset, target=target, session_scope=scope)
    return plan


async def _build(db, link, scope, *, reset=False, target=None):
    assert claim_build(db, link.id)
    error = await run_build(link.id, reset=reset, target=target, session_scope=scope)
    db.refresh(link)
    return error


async def _guild_roles(guild):
    return [dict(r) for r in guild.roles.values()]


def _ow(guild, channel_name: str, target_id: int, type: int | None = None):
    return guild.overwrite(guild.channel(channel_name, type), target_id)


class TestFirstBuild:
    async def test_creates_roles_channels_and_the_gate(self, db, link, guild, scope):
        plan = await _preview(link, scope)
        groups = dict(plan.groups())
        assert "Role: Tournament Owner" in groups["Create"]
        assert "#verify message" in groups["Create"]
        assert groups["Gate"] == [GATE_NOTICE]

        assert await _build(db, link, scope) is None
        assert link.built_at is not None
        assert link.last_build_status == "succeeded"

        assert guild.roles_top_down() == [
            "NEXUS",
            "Tournament Owner",
            "Tournament Director",
            "Test Coordinator",
            "Volunteer Coordinator",
            *[
                r.label
                for r in sorted(
                    db.query(TournamentRole).filter_by(tournament_id=link.tournament_id),
                    key=lambda r: (r.rank, r.label.casefold()),
                )
                if r.rank > 20
            ],
            "Anatomy C",
            "Circuit Lab B",
            "Circuit Lab C",
            "Verified",
            "@everyone",
        ]
        assert int(guild.role("Tournament Owner")["permissions"]) == ADMINISTRATOR
        assert int(guild.role("Tournament Director")["permissions"]) == ADMINISTRATOR
        assert int(guild.role("Volunteer Coordinator")["permissions"]) == STAFF_PERMISSIONS
        assert int(guild.role("Runner")["permissions"]) == 0
        assert int(guild.role("Verified")["permissions"]) == VIEW_CHANNEL
        assert not int(guild.roles[GUILD_ID]["permissions"]) & VIEW_CHANNEL

        assert guild.category_names() == ["Rowland Hall", "Other Events"]
        rowland = guild.channel("Rowland Hall", GUILD_CATEGORY)
        assert guild.children(rowland) == ["circuit-lab-b", "circuit-lab-c"]
        assert guild.children(guild.channel("Other Events", GUILD_CATEGORY)) == ["anatomy-c"]
        assert guild.children(None) == ["verify"]

    async def test_event_channel_overwrites(self, db, link, guild, scope):
        await _build(db, link, scope)
        staff = int(guild.role("Volunteer Coordinator")["id"])
        event_role = int(guild.role("Circuit Lab C")["id"])
        other_event_role = int(guild.role("Circuit Lab B")["id"])
        assert _ow(guild, "circuit-lab-c", GUILD_ID) == (0, VIEW_CHANNEL)
        assert _ow(guild, "circuit-lab-c", event_role) == (VIEW_CHANNEL, 0)
        assert _ow(guild, "circuit-lab-c", staff) == (STAFF_OVERWRITE, 0)
        assert _ow(guild, "circuit-lab-c", other_event_role) is None
        assert _ow(guild, "Rowland Hall", staff) == (STAFF_OVERWRITE, 0)
        # Admin roles see everything through Administrator, so they need no overwrite.
        assert _ow(guild, "circuit-lab-c", int(guild.role("Tournament Director")["id"])) is None

    async def test_verify_channel_and_message(self, db, link, guild, scope, mock_discord_rest):
        await _build(db, link, scope)
        verified = int(guild.role("Verified")["id"])
        staff = int(guild.role("Test Coordinator")["id"])
        everyone_allow, everyone_deny = _ow(guild, "verify", GUILD_ID)
        assert everyone_allow == VIEW_CHANNEL | READ_MESSAGE_HISTORY
        assert everyone_deny & SEND_MESSAGES
        assert _ow(guild, "verify", verified) == (0, VIEW_CHANNEL)
        assert _ow(guild, "verify", staff) == (STAFF_OVERWRITE, 0)

        verify_id = int(guild.channel("verify")["id"])
        [message] = mock_discord_rest.messages[verify_id].values()
        [row] = message["components"]
        button, link_button, help_button = row["components"]
        assert button["custom_id"] == f"nexus:verify:{verified}"
        assert link_button["url"] == "http://localhost:3000/connect/discord"
        assert help_button["url"] == VOLUNTEER_GUIDE_URL
        assert link.verify_message_id is not None

    async def test_saves_every_id_and_tier(self, db, link, guild, scope, events):
        await _build(db, link, scope)
        roles = {
            (r.kind, r.nexus_id): r for r in db.query(DiscordManagedRole).filter_by(link_id=link.id)
        }
        coordinator = (
            db.query(TournamentRole)
            .filter_by(tournament_id=link.tournament_id, label="Volunteer Coordinator")
            .one()
        )
        assert roles[("role", coordinator.id)].tier == "staff"
        assert link.owner_role_id == int(guild.role("Tournament Owner")["id"])
        assert link.verified_role_id == int(guild.role("Verified")["id"])
        keys = {c.key for c in db.query(DiscordManagedChannel).filter_by(link_id=link.id)}
        buildings = {k for k in keys if k.startswith("building:")}
        assert len(buildings) == 1
        assert keys - buildings == {f"event:{e.id}" for e in events.values()} | {"other"}

    async def test_marks_the_whole_server_dirty(self, db, link, guild, scope):
        await _build(db, link, scope)
        assert db.query(DiscordSyncMark).filter_by(link_id=link.id, kind="full").count() == 1

    async def test_running_it_again_changes_nothing(
        self, db, link, guild, scope, mock_discord_rest
    ):
        await _build(db, link, scope)
        assert (await _preview(link, scope)).empty
        assert (await _preview(link, scope, reset=True)).empty
        mock_discord_rest.writes.clear()
        await _build(db, link, scope)
        assert mock_discord_rest.writes == []


class TestAdoption:
    async def test_adopts_exactly_one_match_by_name(self, db, link, guild, scope):
        volunteer = guild.add_role("Volunteer", 1 << 11)
        guild.add_role("Runner")
        guild.add_role("Runner")
        anatomy = guild.add_channel("anatomy-c")

        plan = await _preview(link, scope)
        groups = dict(plan.groups())
        assert "Role: Volunteer" in groups["Adopt"]
        assert "#anatomy-c" in groups["Adopt"]
        assert "Role: Runner" in groups["Create"]

        await _build(db, link, scope)
        assert int(guild.role("Volunteer")["id"]) == volunteer
        assert int(guild.role("Volunteer")["permissions"]) == 0
        assert len([r for r in guild.roles.values() if r["name"] == "Runner"]) == 3
        assert int(guild.channel("anatomy-c")["id"]) == anatomy
        assert (
            guild.channel("anatomy-c")["parent_id"]
            == guild.channel("Other Events", GUILD_CATEGORY)["id"]
        )


class TestChecks:
    async def test_roles_above_the_bot_are_skipped_and_reported(self, db, link, guild, scope):
        above = guild.add_role("Volunteer", top=True)
        plan = await _preview(link, scope)
        assert "Move lobot's role above Volunteer." in plan.warnings
        assert not plan.blocked
        await _build(db, link, scope)
        assert [r["name"] for r in guild.roles.values()].count("Volunteer") == 1
        assert int(guild.role("Volunteer")["id"]) == above

    async def test_missing_administrator_blocks(self, db, link, guild, scope):
        guild.roles[guild.bot_role]["permissions"] = "0"
        plan = await _preview(link, scope)
        assert plan.blocked
        assert "Administrator" in plan.blockers[0]
        error = await _build(db, link, scope)
        assert "Administrator" in error
        assert link.last_build_status == "failed"
        assert link.built_at is None

    async def test_too_many_roles_blocks(self, db, link, guild, scope):
        for i in range(240):
            guild.add_role(f"Extra {i}")
        plan = await _preview(link, scope)
        assert plan.blocked
        assert "over Discord's limit of 250" in plan.blockers[0]

    async def test_only_one_build_at_a_time(self, db, link):
        assert claim_build(db, link.id)
        assert not claim_build(db, link.id)
        link.last_build_at = utcnow() - timedelta(minutes=1)
        db.commit()
        assert not claim_build(db, link.id)
        # An interrupted build stops refreshing last_build_at; after 2 minutes it is retaken.
        link.last_build_at = utcnow() - timedelta(minutes=3)
        db.commit()
        assert claim_build(db, link.id)

    async def test_long_builds_keep_their_claim(self, db, link, guild, scope, monkeypatch):
        from app.core.discord import build as build_module

        monkeypatch.setattr(build_module, "HEARTBEAT_SECONDS", 0)
        assert claim_build(db, link.id)
        link.last_build_at = utcnow() - timedelta(minutes=30)
        db.commit()
        await run_build(link.id, reset=False, target=None, session_scope=scope)
        db.refresh(link)
        assert utcnow() - link.last_build_at < timedelta(minutes=1)


class TestResume:
    async def test_interrupted_build_resumes_without_duplicates(
        self, db, link, guild, scope, mock_discord_rest
    ):
        real = mock_discord_rest.create_channel
        calls = 0

        async def failing(guild_id, **fields):
            nonlocal calls
            calls += 1
            if calls == 3:
                raise RuntimeError("redeployed")
            return await real(guild_id, **fields)

        mock_discord_rest.create_channel = failing
        error = await _build(db, link, scope)
        assert error == "redeployed"
        assert link.last_build_status == "failed"
        assert link.built_at is None
        roles_after_crash = len(guild.roles)

        mock_discord_rest.create_channel = real
        assert await _build(db, link, scope) is None
        assert len(guild.roles) == roles_after_crash
        names = [c["name"] for c in guild.channels.values()]
        assert len(names) == len(set(names))
        assert (await _preview(link, scope)).empty


class TestStaffAccess:
    async def test_added_to_unmanaged_channels_and_denies_left_alone(self, db, link, guild, scope):
        await _build(db, link, scope)
        staff = int(guild.role("Volunteer Coordinator")["id"])
        general = guild.add_channel("general")
        hidden = guild.add_channel(
            "td-only",
            overwrites=[{"id": str(staff), "type": 0, "allow": "0", "deny": str(VIEW_CHANNEL)}],
        )
        plan = await _preview(link, scope)
        assert "Add Volunteer Coordinator to #general" in dict(plan.groups())["Staff access"]
        await _build(db, link, scope)
        assert guild.overwrite(guild.channels[general], staff) == (STAFF_OVERWRITE, 0)
        assert guild.overwrite(guild.channels[hidden], staff) == (0, VIEW_CHANNEL)

    async def test_removed_overwrite_is_added_back(self, db, link, guild, scope, mock_discord_rest):
        await _build(db, link, scope)
        staff = int(guild.role("Volunteer Coordinator")["id"])
        channel = guild.channel("anatomy-c")
        await mock_discord_rest.delete_overwrite(int(channel["id"]), staff)
        await _build(db, link, scope)
        assert guild.overwrite(channel, staff) == (STAFF_OVERWRITE, 0)

    async def test_reset_restores_allow_on_managed_channels_only(
        self, db, link, guild, scope, mock_discord_rest
    ):
        await _build(db, link, scope)
        staff = int(guild.role("Volunteer Coordinator")["id"])
        managed = guild.channel("anatomy-c")
        unmanaged = guild.add_channel(
            "td-only",
            overwrites=[{"id": str(staff), "type": 0, "allow": "0", "deny": str(VIEW_CHANNEL)}],
        )
        await mock_discord_rest.put_overwrite(
            int(managed["id"]), staff, allow=0, deny=VIEW_CHANNEL, type=ROLE_OVERWRITE
        )
        # Without /reset, an explicit deny is left alone even on a managed channel.
        await _build(db, link, scope)
        assert guild.overwrite(managed, staff) == (0, VIEW_CHANNEL)
        await _build(db, link, scope, reset=True)
        assert guild.overwrite(managed, staff) == (STAFF_OVERWRITE, 0)
        assert guild.overwrite(guild.channels[unmanaged], staff) == (0, VIEW_CHANNEL)

    async def test_role_that_stops_being_staff_loses_its_allows(self, db, link, guild, scope):
        await _build(db, link, scope)
        staff = int(guild.role("Volunteer Coordinator")["id"])
        general = guild.add_channel("general")
        await _build(db, link, scope)
        assert guild.overwrite(guild.channels[general], staff) == (STAFF_OVERWRITE, 0)

        role = (
            db.query(TournamentRole)
            .filter_by(tournament_id=link.tournament_id, label="Volunteer Coordinator")
            .one()
        )
        role.permissions = [p for p in role.permissions if p != "manage_discord"]
        db.commit()
        # Sync never applies configuration; only /reset does.
        assert (await _preview(link, scope)).empty

        plan = await _preview(link, scope, reset=True)
        groups = dict(plan.groups())
        assert "Volunteer Coordinator: permissions" in groups["Undo hand edits"]
        assert "Remove Volunteer Coordinator from #general" in groups["Staff access"]
        await _build(db, link, scope, reset=True)
        assert int(guild.role("Volunteer Coordinator")["permissions"]) == 0
        assert guild.overwrite(guild.channels[general], staff) is None
        assert _ow(guild, "anatomy-c", staff) is None
        row = (
            db.query(DiscordManagedRole)
            .filter_by(link_id=link.id, kind="role", nexus_id=role.id)
            .one()
        )
        assert row.tier is None


class TestReset:
    async def test_preview_lists_exactly_what_the_run_undoes(self, db, link, guild, scope):
        await _build(db, link, scope)
        coordinator = guild.role("Volunteer Coordinator")
        coordinator["name"] = "VC"
        coordinator["permissions"] = str(ADMINISTRATOR)
        coordinator["color"] = 0xFF0000
        circuit = guild.channel("circuit-lab-c")
        circuit["name"] = "circuits"
        circuit["topic"] = "Bring a multimeter"
        circuit["parent_id"] = guild.channel("Other Events", GUILD_CATEGORY)["id"]
        member_overwrite = {
            "id": "777",
            "type": MEMBER_OVERWRITE,
            "allow": str(VIEW_CHANNEL),
            "deny": "0",
        }
        circuit["permission_overwrites"].append(member_overwrite)
        guild.roles[GUILD_ID]["permissions"] = str(VIEW_CHANNEL)

        plan = await _preview(link, scope, reset=True)
        assert sorted(dict(plan.groups())["Undo hand edits"]) == sorted(
            [
                "Volunteer Coordinator: renamed from VC, permissions",
                "#circuit-lab-c: renamed from #circuits, moved from Other Events",
                "@everyone: View Channels",
            ]
        )
        await _build(db, link, scope, reset=True)
        assert coordinator["name"] == "Volunteer Coordinator"
        assert int(coordinator["permissions"]) == STAFF_PERMISSIONS
        assert coordinator["color"] == 0xFF0000
        assert circuit["name"] == "circuit-lab-c"
        assert circuit["topic"] == "Bring a multimeter"
        assert circuit["parent_id"] == guild.channel("Rowland Hall", GUILD_CATEGORY)["id"]
        assert member_overwrite in circuit["permission_overwrites"]
        assert not int(guild.roles[GUILD_ID]["permissions"]) & VIEW_CHANNEL
        assert (await _preview(link, scope, reset=True)).empty

    async def test_restores_managed_overwrites_and_keeps_unmanaged_roles(
        self, db, link, guild, scope, mock_discord_rest
    ):
        await _build(db, link, scope)
        channel = guild.channel("anatomy-c")
        mods = guild.add_role("Mods")
        await mock_discord_rest.put_overwrite(
            int(channel["id"]), mods, allow=VIEW_CHANNEL, deny=0, type=0
        )
        await mock_discord_rest.put_overwrite(
            int(channel["id"]), GUILD_ID, allow=VIEW_CHANNEL, deny=0, type=0
        )
        plan = await _preview(link, scope, reset=True)
        assert "#anatomy-c: overwrites" in dict(plan.groups())["Undo hand edits"]
        await _build(db, link, scope, reset=True)
        assert guild.overwrite(channel, GUILD_ID) == (0, VIEW_CHANNEL)
        assert guild.overwrite(channel, mods) == (VIEW_CHANNEL, 0)

    async def test_changed_layout_archives_and_creates(self, db, link, guild, scope):
        await _build(db, link, scope)
        circuit_b = guild.channel("circuit-lab-b")
        category = EventCategory(name="Lab")
        db.add(category)
        db.flush()
        catalog = Event(name="Circuit Lab", category_id=category.id)
        db.add(catalog)
        db.flush()
        for event in db.query(TournamentEvent).filter_by(name="Circuit Lab"):
            event.event_id = catalog.id
        link.merge_divisions = True
        db.commit()

        plan = await _preview(link, scope, reset=True)
        groups = dict(plan.groups())
        assert "#circuit-lab-bc" in groups["Create"]
        assert "Category: Archived" in groups["Create"]
        assert sorted(groups["Archive"]) == ["#circuit-lab-b", "#circuit-lab-c"]
        await _build(db, link, scope, reset=True)
        archived = guild.channel("Archived", GUILD_CATEGORY)
        assert circuit_b["parent_id"] == archived["id"]
        assert guild.children(guild.channel("Rowland Hall", GUILD_CATEGORY)) == ["circuit-lab-bc"]
        staff = int(guild.role("Volunteer Coordinator")["id"])
        assert guild.overwrite(archived, staff) == (STAFF_OVERWRITE, 0)
        assert (await _preview(link, scope, reset=True)).empty


class TestScopedReset:
    async def test_role_reset_changes_only_that_role(self, db, link, guild, scope):
        await _build(db, link, scope)
        coordinator = guild.role("Volunteer Coordinator")
        tester = guild.role("Test Coordinator")
        coordinator["permissions"] = "0"
        tester["permissions"] = "0"
        target = Target("role", int(coordinator["id"]))
        plan = await _preview(link, scope, target=target)
        assert dict(plan.groups())["Undo hand edits"] == ["Volunteer Coordinator: permissions"]
        await _build(db, link, scope, target=target)
        assert int(coordinator["permissions"]) == STAFF_PERMISSIONS
        assert int(tester["permissions"]) == 0

    async def test_channel_reset_changes_only_that_channel(self, db, link, guild, scope):
        await _build(db, link, scope)
        anatomy = guild.channel("anatomy-c")
        circuit = guild.channel("circuit-lab-c")
        anatomy["name"] = "anatomy"
        circuit["name"] = "circuits"
        await _build(db, link, scope, target=Target("channel", int(anatomy["id"])))
        assert anatomy["name"] == "anatomy-c"
        assert circuit["name"] == "circuits"

    async def test_category_reset_covers_its_channels(self, db, link, guild, scope):
        await _build(db, link, scope)
        rowland = guild.channel("Rowland Hall", GUILD_CATEGORY)
        rowland["name"] = "Rowland"
        guild.channel("circuit-lab-c")["name"] = "circuits"
        guild.channel("anatomy-c")["name"] = "anatomy"
        await _build(db, link, scope, target=Target("channel", int(rowland["id"])))
        assert rowland["name"] == "Rowland Hall"
        assert guild.children(rowland) == ["circuit-lab-b", "circuit-lab-c"]
        assert guild.channel("anatomy")

    async def test_unmanaged_target_is_refused(self, db, link, guild, scope):
        await _build(db, link, scope)
        general = guild.add_channel("general")
        mods = guild.add_role("Mods")
        for target in (Target("channel", general), Target("role", mods)):
            plan = await _preview(link, scope, target=target)
            assert plan.blockers == ["lobot doesn't manage this."]


class TestRecreatedRoles:
    async def test_recreated_event_role_gets_its_channel_back(self, db, link, guild, scope):
        await _build(db, link, scope)
        role = guild.role("Anatomy C")
        del guild.roles[int(role["id"])]
        channel = guild.channel("anatomy-c")
        channel["permission_overwrites"] = [
            o for o in channel["permission_overwrites"] if o["id"] != role["id"]
        ]
        plan = await _preview(link, scope)
        assert sorted(dict(plan.groups())["Create"]) == [
            "Anatomy C on #anatomy-c",
            "Role: Anatomy C",
        ]
        await _build(db, link, scope)
        new_role = int(guild.role("Anatomy C")["id"])
        assert guild.overwrite(channel, new_role) == (VIEW_CHANNEL, 0)
        assert (await _preview(link, scope)).empty

    async def test_existing_overwrites_are_left_for_reset(
        self, db, link, guild, scope, mock_discord_rest
    ):
        await _build(db, link, scope)
        role = int(guild.role("Anatomy C")["id"])
        channel = guild.channel("anatomy-c")
        await mock_discord_rest.put_overwrite(
            int(channel["id"]), role, allow=0, deny=VIEW_CHANNEL, type=0
        )
        assert (await _preview(link, scope)).empty
        assert (
            "#anatomy-c: overwrites"
            in dict((await _preview(link, scope, reset=True)).groups())["Undo hand edits"]
        )

    async def test_reorder_survives_tied_positions(self, db, link, guild, scope):
        await _build(db, link, scope)
        guild.add_role("Mods")
        # Discord can report equal positions right after a run of creates.
        for role in guild.roles.values():
            if role["name"] not in ("NEXUS", "@everyone"):
                role["position"] = 1
        guild.role("Verified")["position"] = 2
        plan = await _preview(link, scope, reset=True)
        assert "Role order" in dict(plan.groups())["Undo hand edits"]
        await _build(db, link, scope, reset=True)
        order = guild.roles_top_down()
        assert order[:3] == ["NEXUS", "Tournament Owner", "Tournament Director"]
        assert order[-3:] == ["Verified", "Mods", "@everyone"]


class TestTiedPositions:
    """A new server can report every role at position 1; Discord then ranks by id."""

    @pytest.fixture
    def tied(self, guild):
        guild.tied_positions = True
        for role_id, role in guild.roles.items():
            role["position"] = 0 if role_id == GUILD_ID else 1
        return guild

    async def test_first_build_works_without_false_warnings(self, db, link, tied, scope):
        plan = await _preview(link, scope)
        assert plan.warnings == []
        assert await _build(db, link, scope) is None
        assert link.built_at is not None
        ranked = [r.name for r in ranked_roles(parse_roles(await _guild_roles(tied)), GUILD_ID)]
        assert ranked[:3] == ["NEXUS", "Tournament Owner", "Tournament Director"]
        assert ranked[-1] == "Verified"
        assert (await _preview(link, scope, reset=True)).empty

    async def test_reset_that_cant_reorder_warns_instead_of_failing(self, db, link, tied, scope):
        await _build(db, link, scope)
        roles = {
            r.label: r for r in db.query(TournamentRole).filter_by(tournament_id=link.tournament_id)
        }
        roles["Runner"].rank, roles["Volunteer"].rank = (
            roles["Volunteer"].rank,
            roles["Runner"].rank,
        )
        db.commit()
        plan = await _preview(link, scope, reset=True)
        assert "Role order" in dict(plan.groups())["Undo hand edits"]
        assert any("drag any role" in w for w in plan.warnings)
        assert await _build(db, link, scope, reset=True) is None
        assert link.last_build_status == "succeeded"


async def test_admin_roles_are_created_hoisted(db, link, guild, scope):
    db.add(
        TournamentRole(
            tournament_id=link.tournament_id,
            label="Co-Director",
            rank=15,
            permissions=["manage_tournament"],
        )
    )
    db.commit()
    await _build(db, link, scope)
    hoisted = {r["name"] for r in guild.roles.values() if r.get("hoist")}
    assert hoisted == {"Tournament Director", "Co-Director"}

    # Only at creation: an admin unhoisting it is never undone, even by /reset.
    guild.role("Tournament Director")["hoist"] = False
    await _build(db, link, scope, reset=True)
    assert guild.role("Tournament Director")["hoist"] is False
