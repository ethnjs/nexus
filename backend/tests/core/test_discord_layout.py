"""layout.py is pure, so these build its inputs by hand."""

import pytest

from app.core.discord.layout import (
    CATEGORY_CAPACITY,
    FIXED_CATEGORIES,
    CategorySpec,
    LayoutEvent,
    LayoutRole,
    LayoutSettings,
    Occupancy,
    Place,
    channel_key,
    compute_layout,
    nickname,
    role_tier,
    slug,
)
from app.services.discord.permissions import ADMINISTRATOR, STAFF_PERMISSIONS, VIEW_CHANNEL

BY_BUILDING = LayoutSettings(merge_divisions=False, category_grouping="building")
MERGE_BY_BUILDING = LayoutSettings(merge_divisions=True, category_grouping="building")
MERGE_BY_ZONE = LayoutSettings(merge_divisions=True, category_grouping="zone")

ROWLAND = Place(1, "Rowland Hall")
STEINHAUS = Place(2, "Steinhaus")
NORTH = Place(10, "North Zone")


def _event(
    id: int,
    name: str,
    division: str | None = "C",
    catalog_id: int | None = None,
    building: Place | None = None,
    zone: Place | None = None,
) -> LayoutEvent:
    return LayoutEvent(
        id=id,
        name=f"{name} {division}" if division else name,
        division=division,
        catalog_id=catalog_id,
        catalog_name=name if catalog_id else None,
        building=building,
        zone=zone,
    )


def _event_categories(layout) -> tuple[CategorySpec, ...]:
    return layout.categories[len(FIXED_CATEGORIES) :]


def _channels(layout) -> list[tuple[str, str, str]]:
    return [(c.category_key, c.name, c.key) for c in layout.channels]


class TestRoles:
    def test_order_and_permissions(self):
        roles = [
            LayoutRole(3, "Volunteer", 50, frozenset()),
            LayoutRole(1, "Tournament Director", 10, frozenset({"manage_tournament"})),
            LayoutRole(2, "Volunteer Coordinator", 20, frozenset({"manage_discord"})),
        ]
        events = [_event(20, "Circuit Lab"), _event(21, "Anatomy", "B")]
        layout = compute_layout(roles, events, BY_BUILDING)
        assert [(r.key, r.name, r.tier) for r in layout.roles] == [
            ("owner", "Tournament Owner", "admin"),
            ("role:1", "Tournament Director", "admin"),
            ("role:2", "Volunteer Coordinator", "staff"),
            ("role:3", "Volunteer", None),
            ("event:21", "Anatomy B", None),
            ("event:20", "Circuit Lab C", None),
            ("verified", "Verified", None),
        ]
        perms = {r.key: r.permissions for r in layout.roles}
        assert perms["owner"] == perms["role:1"] == ADMINISTRATOR
        assert perms["role:2"] == STAFF_PERMISSIONS
        assert perms["role:3"] == perms["event:20"] == 0
        assert perms["verified"] == VIEW_CHANNEL

    def test_every_role_gets_a_discord_role_even_without_holders(self):
        layout = compute_layout([LayoutRole(9, "Awards", 60, frozenset())], [], BY_BUILDING)
        assert "role:9" in {r.key for r in layout.roles}

    @pytest.mark.parametrize(
        ("permissions", "tier"),
        [
            ({"manage_tournament", "manage_discord"}, "admin"),
            ({"manage_tournament"}, "admin"),
            ({"manage_discord", "manage_members"}, "staff"),
            ({"manage_members"}, None),
            (set(), None),
        ],
    )
    def test_tiers(self, permissions, tier):
        assert role_tier(permissions) == tier


class TestNames:
    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("Circuit Lab C", "circuit-lab-c"),
            ("Circuit Lab BC", "circuit-lab-bc"),
            ("  Write It / Do It!! ", "write-it-do-it"),
            ("Codebusters (Trial) A", "codebusters-trial-a"),
            ("???", "event"),
            ("x" * 150, "x" * 100),
        ],
    )
    def test_slug(self, name, expected):
        assert slug(name) == expected

    @pytest.mark.parametrize(
        ("first", "last", "expected"),
        [
            ("Pat", "Smith", "Pat S."),
            ("  Mary   Ann ", " van Dyke", "Mary Ann V."),
            ("Pat", None, "Pat"),
            ("Pat", "  ", "Pat"),
            (None, "Smith", None),
            ("  ", "Smith", None),
            ("x" * 40, "Smith", "x" * 29 + " S."),
            ("x" * 40, None, "x" * 32),
        ],
    )
    def test_nickname(self, first, last, expected):
        assert nickname(first, last) == expected

    def test_channel_keys_sort_event_ids(self):
        assert channel_key([13, 2, 12]) == "event:2,12,13"

    def test_custom_events_use_their_display_name(self):
        layout = compute_layout([], [_event(5, "Mystery Event", None)], BY_BUILDING)
        assert [c.name for c in layout.channels] == ["mystery-event"]


class TestMerge:
    def test_same_catalog_event_in_the_same_building_merges(self):
        events = [
            _event(1, "Circuit Lab", "B", catalog_id=100, building=ROWLAND),
            _event(2, "Circuit Lab", "C", catalog_id=100, building=ROWLAND),
        ]
        layout = compute_layout([], events, MERGE_BY_BUILDING)
        assert _channels(layout) == [("building:1", "circuit-lab-bc", "event:1,2")]
        # Event roles stay per event.
        assert {r.name for r in layout.roles} >= {"Circuit Lab B", "Circuit Lab C"}

    def test_different_buildings_dont_merge(self):
        events = [
            _event(1, "Circuit Lab", "B", catalog_id=100, building=ROWLAND),
            _event(2, "Circuit Lab", "C", catalog_id=100, building=STEINHAUS),
        ]
        layout = compute_layout([], events, MERGE_BY_BUILDING)
        assert _channels(layout) == [
            ("building:1", "circuit-lab-b", "event:1"),
            ("building:2", "circuit-lab-c", "event:2"),
        ]

    def test_unplaced_events_count_as_the_same_place(self):
        events = [
            _event(1, "Circuit Lab", "B", catalog_id=100),
            _event(2, "Circuit Lab", "C", catalog_id=100),
        ]
        layout = compute_layout([], events, MERGE_BY_BUILDING)
        assert _channels(layout) == [("other", "circuit-lab-bc", "event:1,2")]

    def test_custom_events_never_merge(self):
        events = [_event(1, "Mystery", "B"), _event(2, "Mystery", "C")]
        layout = compute_layout([], events, MERGE_BY_BUILDING)
        assert [c.key for c in layout.channels] == ["event:1", "event:2"]

    def test_merge_off_keeps_one_channel_per_event(self):
        events = [
            _event(1, "Circuit Lab", "B", catalog_id=100, building=ROWLAND),
            _event(2, "Circuit Lab", "C", catalog_id=100, building=ROWLAND),
        ]
        layout = compute_layout([], events, BY_BUILDING)
        assert [c.name for c in layout.channels] == ["circuit-lab-b", "circuit-lab-c"]

    def test_zone_grouping_merges_by_zone(self):
        events = [
            _event(1, "Circuit Lab", "B", catalog_id=100, building=ROWLAND, zone=NORTH),
            _event(2, "Circuit Lab", "C", catalog_id=100, building=STEINHAUS, zone=NORTH),
        ]
        layout = compute_layout([], events, MERGE_BY_ZONE)
        assert _channels(layout) == [("zone:10", "circuit-lab-bc", "event:1,2")]
        assert [(c.key, c.name) for c in _event_categories(layout)] == [("zone:10", "North Zone")]


class TestCategories:
    def test_named_after_buildings_with_other_events_last(self):
        events = [
            _event(1, "Anatomy", building=STEINHAUS),
            _event(2, "Botany", building=ROWLAND),
            _event(3, "Chemistry"),
        ]
        layout = compute_layout([], events, BY_BUILDING)
        assert [(c.key, c.name) for c in _event_categories(layout)] == [
            ("building:1", "Rowland Hall"),
            ("building:2", "Steinhaus"),
            ("other", "Other Events"),
        ]
        assert _channels(layout) == [
            ("building:1", "botany-c", "event:2"),
            ("building:2", "anatomy-c", "event:1"),
            ("other", "chemistry-c", "event:3"),
        ]

    def test_events_when_nothing_is_placed(self):
        layout = compute_layout([], [_event(1, "Anatomy"), _event(2, "Botany")], BY_BUILDING)
        assert [(c.key, c.name) for c in _event_categories(layout)] == [("other", "Events")]

    def test_no_other_category_when_everything_is_placed(self):
        layout = compute_layout([], [_event(1, "Anatomy", building=ROWLAND)], BY_BUILDING)
        assert [c.key for c in _event_categories(layout)] == ["building:1"]

    def test_zone_grouping_ignores_buildings(self):
        events = [_event(1, "Anatomy", building=ROWLAND), _event(2, "Botany", zone=NORTH)]
        layout = compute_layout([], events, MERGE_BY_ZONE)
        assert [(c.key, c.name) for c in _event_categories(layout)] == [
            ("zone:10", "North Zone"),
            ("other", "Other Events"),
        ]

    def test_channels_alphabetical_within_a_category(self):
        events = [
            _event(i, name, building=ROWLAND) for i, name in enumerate(["Zoo", "Ants", "Mid"])
        ]
        layout = compute_layout([], events, BY_BUILDING)
        assert [c.name for c in layout.channels] == ["ants-c", "mid-c", "zoo-c"]

    def test_overflow_past_fifty_channels(self):
        events = [
            _event(i, f"Event {i:03d}", building=ROWLAND) for i in range(CATEGORY_CAPACITY + 3)
        ]
        layout = compute_layout([], events, BY_BUILDING)
        assert [(c.key, c.name) for c in _event_categories(layout)] == [
            ("building:1", "Rowland Hall"),
            ("building:1:2", "Rowland Hall (2)"),
        ]
        first = [c for c in layout.channels if c.category_key == "building:1"]
        second = [c for c in layout.channels if c.category_key == "building:1:2"]
        assert len(first) == CATEGORY_CAPACITY
        assert [c.name for c in second] == ["event-050-c", "event-051-c", "event-052-c"]

    def test_overflow_counts_channels_already_in_the_category(self):
        events = [_event(i, f"Event {i}", building=ROWLAND) for i in range(3)]
        layout = compute_layout([], events, BY_BUILDING, Occupancy(taken={"building:1": 48}))
        assert _channels(layout) == [
            ("building:1", "event-0-c", "event:0"),
            ("building:1", "event-1-c", "event:1"),
            ("building:1:2", "event-2-c", "event:2"),
        ]

    def test_channels_stay_in_their_places_categories(self):
        events = [_event(i, f"Event {i}", building=ROWLAND) for i in range(3)]
        occupancy = Occupancy(current={"event:0": "building:1:2", "event:2": "building:1"})
        layout = compute_layout([], events, BY_BUILDING, occupancy)
        assert _channels(layout) == [
            ("building:1", "event-1-c", "event:1"),
            ("building:1", "event-2-c", "event:2"),
            ("building:1:2", "event-0-c", "event:0"),
        ]

    def test_a_moving_channel_holds_its_old_slot(self):
        events = [_event(1, "Anatomy", building=ROWLAND), _event(2, "Botany", building=STEINHAUS)]
        occupancy = Occupancy(current={"event:1": "building:2"}, taken={"building:2": 49})
        layout = compute_layout([], events, BY_BUILDING, occupancy)
        assert _channels(layout) == [
            ("building:1", "anatomy-c", "event:1"),
            ("building:2:2", "botany-c", "event:2"),
        ]

    def test_without_moving_channels_elsewhere_stay_and_take_no_room(self):
        events = [_event(1, "Anatomy", building=ROWLAND), _event(2, "Botany", building=ROWLAND)]
        occupancy = Occupancy(
            current={"event:1": None}, taken={"building:1": CATEGORY_CAPACITY - 1}, moving=False
        )
        layout = compute_layout([], events, BY_BUILDING, occupancy)
        assert [c.key for c in _event_categories(layout)] == ["building:1"]

    def test_empty_track_has_only_the_fixed_categories(self):
        layout = compute_layout([], [], BY_BUILDING)
        assert [(c.key, c.name) for c in layout.categories] == [
            ("information", "Information"),
            ("volunteers", "Volunteers"),
        ]
        assert [(c.category_key, c.name) for c in layout.fixed_channels] == [
            ("information", "announcements"),
            ("information", "useful-links"),
            ("volunteers", "general"),
            ("volunteers", "random"),
        ]
        assert layout.channels == ()


class TestKeysAcrossSettings:
    def test_turning_merge_on_replaces_per_event_keys(self):
        events = [
            _event(1, "Circuit Lab", "B", catalog_id=100, building=ROWLAND),
            _event(2, "Circuit Lab", "C", catalog_id=100, building=ROWLAND),
            _event(3, "Anatomy", "C", catalog_id=101, building=ROWLAND),
        ]
        before = {c.key for c in compute_layout([], events, BY_BUILDING).channels}
        after = {c.key for c in compute_layout([], events, MERGE_BY_BUILDING).channels}
        assert before == {"event:1", "event:2", "event:3"}
        assert after == {"event:1,2", "event:3"}

    def test_switching_grouping_changes_category_keys_not_channel_keys(self):
        events = [_event(1, "Anatomy", building=ROWLAND, zone=NORTH)]
        by_building = compute_layout([], events, BY_BUILDING)
        by_zone = compute_layout(
            [], events, LayoutSettings(merge_divisions=False, category_grouping="zone")
        )
        assert [c.key for c in by_building.channels] == [c.key for c in by_zone.channels]
        assert by_building.channels[0].category_key == "building:1"
        assert by_zone.channels[0].category_key == "zone:10"
