"""Tests for GET/PUT /tournaments/{tournament_id}/display-config/
(app/api/routes/tournament/display_config.py)."""
from datetime import date, datetime, timezone
from app.models.models import (
    Form, FormField, TournamentMembership, TournamentMembershipEventPreference,
    TournamentMembershipLunch, TournamentMembershipTrackStatus, TournamentTrack,
)
from tests.conftest import grant_role, login, primary_track_id, set_display_config


# ---------------------------------------------------------------------------
# GET — manage_members, lenient on read
# ---------------------------------------------------------------------------

def test_get_display_config_defaults_to_empty(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/display-config/")
    assert response.status_code == 200
    assert response.json() == {}


def test_get_display_config_requires_manage_members(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/display-config/").status_code == 403


def test_get_display_config_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/display-config/").status_code == 404


def test_get_display_config_lenient_on_stale_data(client, td_user, td_tournament, db):
    """A deleted track (or a surface key from a since-removed UI location)
    leaves a dangling reference behind — reading it back must never 500."""
    set_display_config(db, td_tournament, td_user, {
        "unknown_surface": {"hidden": ["track:999", "not_a_real_namespace:x"]},
    })
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/display-config/")
    assert response.status_code == 200
    # `columns`/`sections`/`filters`/`sort` come back as None: absent means
    # "use the defaults", which is why they aren't empty lists.
    assert response.json() == {
        "unknown_surface": {
            "hidden": ["track:999", "not_a_real_namespace:x"],
            "columns": None, "sections": None, "filters": None, "sort": None,
        },
    }


# ---------------------------------------------------------------------------
# PUT — manage_members, strict on write
# ---------------------------------------------------------------------------

def test_put_display_config_saves_valid_config(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    payload = {
        "members_panel": {"hidden": ["track:3", "lunch_category:entree"]},
        "member_page": {"hidden": ["event_pref:morning"]},
    }
    response = client.put(f"/tournaments/{td_tournament.id}/display-config/", json=payload)
    assert response.status_code == 200
    saved = {
        surface: {**config, "columns": None, "sections": None, "filters": None, "sort": None}
        for surface, config in payload.items()
    }
    assert response.json() == saved

    follow_up = client.get(f"/tournaments/{td_tournament.id}/display-config/")
    assert follow_up.json() == saved


def test_display_config_is_per_member(client, td_user, other_user, td_tournament, db):
    """The whole point of the move: two coordinators on the same roster each
    keep their own columns instead of overwriting each other."""
    grant_role(db, td_tournament, other_user, "Tournament Director")
    login(client, "td@test.com", "tdpass")
    client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_table": {"columns": ["email"]}},
    )

    login(client, "other@test.com", "otherpass")
    assert client.get(f"/tournaments/{td_tournament.id}/display-config/").json() == {}
    client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_table": {"columns": ["phone"]}},
    )

    login(client, "td@test.com", "tdpass")
    saved = client.get(f"/tournaments/{td_tournament.id}/display-config/").json()
    assert saved["members_table"]["columns"] == ["email"]


def test_put_display_config_saves_filters_and_sort(client, td_user, td_tournament):
    """Filters and sort ride along in the same surface blob — they're the
    same "how this coordinator reads the roster" state the columns are."""
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_table": {
            "filters": {"role": ["3"], "track": ["7:confirmed"]},
            "sort": {"field": "last_name", "direction": "desc"},
        }},
    )
    assert response.status_code == 200
    saved = client.get(f"/tournaments/{td_tournament.id}/display-config/").json()
    assert saved["members_table"]["filters"] == {"role": ["3"], "track": ["7:confirmed"]}
    assert saved["members_table"]["sort"] == {"field": "last_name", "direction": "desc"}


def test_put_display_config_rejects_unknown_filter(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_table": {"filters": {"not_a_filter": ["x"]}}},
    )
    assert response.status_code == 422


def test_put_display_config_keeps_unresolvable_filter_values(client, td_user, td_tournament):
    """Values stay opaque on purpose: a track deleted after someone filtered
    by it is inert on the roster, and must not 422 every later save."""
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_table": {"filters": {"track": ["99999:confirmed"]}}},
    )
    assert response.status_code == 200


def test_put_display_config_rejects_unknown_sort_field(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_table": {"sort": {"field": "shoe_size", "direction": "asc"}}},
    )
    assert response.status_code == 422


def test_put_display_config_rejects_unknown_sort_direction(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_table": {"sort": {"field": "joined", "direction": "sideways"}}},
    )
    assert response.status_code == 422


def test_put_display_config_rejects_unknown_surface(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"not_a_surface": {"hidden": []}},
    )
    assert response.status_code == 422


def test_put_display_config_rejects_unknown_namespace(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_panel": {"hidden": ["not_a_namespace:1"]}},
    )
    assert response.status_code == 422


def test_put_display_config_requires_manage_members(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{other_tournament.id}/display-config/",
        json={"members_panel": {"hidden": []}},
    )
    assert response.status_code == 403


def test_put_display_config_rejects_archived_tournament(client, td_user, td_tournament, db):
    td_tournament.is_archived = True
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_panel": {"hidden": []}},
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# GET .../catalog/ — every toggleable item, surface-agnostic
# ---------------------------------------------------------------------------

def _make_user(db, email="alice@example.com"):
    from app.models.models import User as UserModel
    user = UserModel(first_name="Alice", last_name="Smith", email=email)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_membership(db, tournament_id, user_id):
    membership = TournamentMembership(user_id=user_id, tournament_id=tournament_id, source="manual")
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return membership


def test_get_display_config_catalog_bare_tournament(client, td_user, td_tournament):
    """The barest a tournament gets: no availability, lunch, event prefs or
    custom fields. Tracks are the exception - there is always at least one,
    since that is where a tournament's dates, venue and divisions live."""
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/display-config/catalog/")
    assert response.status_code == 200
    body = response.json()
    main = next(t for t in td_tournament.tracks if t.name == "Main")
    assert [t["label"] for t in body["tracks"]] == ["Main"]
    assert body["availability"] == []
    assert body["lunch_categories"] == []
    assert body["event_preferences"] == []
    assert body["custom_fields"] == []
    # Fixed columns exist regardless of tournament data; each track adds one.
    assert [c["key"] for c in body["columns"]] == [
        "email", "phone", "account_age", "joined", "method", "age", "shirt_size",
        f"track:{main.id}",
    ]
    # Custom Responses is no longer built in — it's seeded as a deletable
    # custom section instead, so it doesn't appear in the catalog.
    assert [s["id"] for s in body["sections"]][:2] == ["membership", "availability"]
    assert "custom_responses" not in [s["id"] for s in body["sections"]]
    # Membership offers its static fields plus one entry per track.
    assert [f["key"] for f in body["sections"][0]["fields"]] == [
        "joined", "join_method", "roles", "age", f"track:{main.id}",
    ]


def test_get_display_config_catalog_includes_tracks(client, td_user, td_tournament, db):
    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    archived = TournamentTrack(tournament_id=td_tournament.id, name="Retired Track", is_archived=True)
    db.add_all([track, archived])
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/display-config/catalog/")
    assert response.status_code == 200
    tracks = response.json()["tracks"]
    assert {"key": f"track:{track.id}", "label": "Test Writing"} in tracks
    assert {"key": f"track:{archived.id}", "label": "Retired Track (archived)"} in tracks


def test_get_display_config_catalog_includes_lunch_categories_deduped(client, td_user, td_tournament, db):
    u1 = _make_user(db, "a@example.com")
    u2 = _make_user(db, "b@example.com")
    m1 = _make_membership(db, td_tournament.id, u1.id)
    m2 = _make_membership(db, td_tournament.id, u2.id)
    db.add_all([
        TournamentMembershipLunch(membership_id=m1.id, date=date(2026, 3, 1), category="entree", value="veggie", label="Veggie wrap"),
        TournamentMembershipLunch(membership_id=m2.id, date=date(2026, 3, 1), category="entree", value="turkey", label="Turkey sandwich"),
    ])
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/display-config/catalog/")
    assert response.status_code == 200
    # Labelled by the category, not by either member's selection.
    assert response.json()["lunch_categories"] == [{"key": "lunch_category:entree", "label": "Entree"}]


def test_get_display_config_catalog_includes_event_preferences(client, td_user, td_tournament, db):
    login(client, "td@test.com", "tdpass")
    event = client.post(f"/tournaments/{td_tournament.id}/events/", json={
        "tournament_id": td_tournament.id, "name": "Boomilever", "division": "C",
    }).json()
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u.id)
    db.add(TournamentMembershipEventPreference(membership_id=m.id, tournament_event_id=event["id"], key="rank", rank=1))
    db.commit()

    response = client.get(f"/tournaments/{td_tournament.id}/display-config/catalog/")
    assert response.status_code == 200
    assert response.json()["event_preferences"] == [{"key": "event_pref:rank", "label": "Rank"}]


def test_get_display_config_catalog_includes_custom_fields_excludes_reserved(client, td_user, td_tournament, db):
    form = Form(
        owner_type="tournament", tournament_id=td_tournament.id, chapter_id=None,
        name="Volunteer interest", title="Volunteer interest", status="published", created_by=td_user.id,
    )
    db.add(form)
    db.flush()
    custom_field = FormField(
        form_id=form.id, order=1, label="Favorite color", question_type="single_select_dropdown",
        field_key="favorite_color", config={"required": False, "options": []},
    )
    reserved_field = FormField(
        form_id=form.id, order=2, label="Track status", question_type="single_select_radio",
        field_key="track_status_writer", config={"required": False, "options": []},
    )
    db.add_all([custom_field, reserved_field])
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/display-config/catalog/")
    assert response.status_code == 200
    # field_key unslugged — not the question label, and not prefixed by the form.
    assert response.json()["custom_fields"] == [
        {"key": f"form_field:{custom_field.id}", "label": "Favorite Color"},
    ]


def test_get_display_config_catalog_requires_manage_members(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/display-config/catalog/").status_code == 403


def test_get_display_config_catalog_includes_availability_days(client, td_user, td_tournament, db):
    """One item per day the tournament runs shifts on, deduped across shifts."""
    from app.models.models import TournamentShift

    db.add_all([
        TournamentShift(tournament_id=td_tournament.id, track_id=primary_track_id(db, td_tournament.id), label="Morning",
            start=datetime(2026, 3, 1, 15, 0, tzinfo=timezone.utc),
            end=datetime(2026, 3, 1, 19, 0, tzinfo=timezone.utc),
        ),
        TournamentShift(tournament_id=td_tournament.id, track_id=primary_track_id(db, td_tournament.id), label="Afternoon",
            start=datetime(2026, 3, 1, 20, 0, tzinfo=timezone.utc),
            end=datetime(2026, 3, 1, 23, 0, tzinfo=timezone.utc),
        ),
        TournamentShift(tournament_id=td_tournament.id, track_id=primary_track_id(db, td_tournament.id), label="Day two",
            start=datetime(2026, 3, 2, 15, 0, tzinfo=timezone.utc),
            end=datetime(2026, 3, 2, 19, 0, tzinfo=timezone.utc),
        ),
    ])
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/display-config/catalog/")
    assert response.status_code == 200
    keys = [item["key"] for item in response.json()["availability"]]
    assert keys == ["availability_day:2026-03-01", "availability_day:2026-03-02"]


def test_membership_panel_pads_tracks_with_pending(client, td_user, td_tournament, db):
    """Every live track appears on the panel, answered or not — an unanswered
    one reads as "pending" rather than being missing."""
    answered = TournamentTrack(tournament_id=td_tournament.id, name="Answered Track")
    unanswered = TournamentTrack(tournament_id=td_tournament.id, name="Unanswered Track")
    retired = TournamentTrack(tournament_id=td_tournament.id, name="Retired Track", is_archived=True)
    db.add_all([answered, unanswered, retired])
    db.flush()
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u.id)
    db.add(TournamentMembershipTrackStatus(
        membership_id=m.id, track_id=answered.id, status="confirmed",
    ))
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/members/{m.id}/")
    assert response.status_code == 200
    by_name = {t["name"]: t["status"] for t in response.json()["track_statuses"]}
    assert by_name == {
        "Answered Track": "confirmed", "Unanswered Track": "pending",
        "Main": "pending",  # the fixture's primary track, also unanswered
    }
    # An archived track nobody answered isn't pending anything.
    assert "Retired Track" not in by_name


def test_hidden_track_stays_hidden_even_when_pending(client, td_user, td_tournament, db):
    """The padding runs before display config, so hiding a track drops it
    whether or not the member ever answered it."""
    hidden_track = TournamentTrack(tournament_id=td_tournament.id, name="Hidden Track")
    shown = TournamentTrack(tournament_id=td_tournament.id, name="Shown Track")
    db.add_all([hidden_track, shown])
    db.flush()
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u.id)
    db.commit()

    login(client, "td@test.com", "tdpass")
    assert client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_panel": {"hidden": [f"track:{hidden_track.id}"]}},
    ).status_code == 200

    response = client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/?surface=members_panel"
    )
    assert response.status_code == 200
    assert [t["name"] for t in response.json()["track_statuses"]] == ["Main", "Shown Track"]


def test_hidden_sections_reports_only_what_filtering_emptied(client, td_user, td_tournament, db):
    """The panel renders a section even when a member has no data for it, so
    an empty list no longer means "hidden" — hidden_sections is what says a
    section was actually filtered away."""
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u.id)
    db.add(TournamentMembershipLunch(
        membership_id=m.id, date=date(2026, 3, 1), category="entree", value="veggie", label="Veggie wrap",
    ))
    db.commit()

    login(client, "td@test.com", "tdpass")
    assert client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_panel": {"hidden": ["lunch_category:entree"]}},
    ).status_code == 200

    body = client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/?surface=members_panel"
    ).json()
    assert body["lunch"] == []
    assert body["hidden_sections"] == ["lunch"]
    # This member simply has no event preferences — that is not "hidden".
    assert body["event_preferences"] == []
    assert "event_preferences" not in body["hidden_sections"]


def test_hidden_sections_empty_when_filtering_removes_nothing(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u.id)
    db.add(TournamentMembershipLunch(
        membership_id=m.id, date=date(2026, 3, 1), category="entree", value="veggie", label="Veggie wrap",
    ))
    db.commit()

    login(client, "td@test.com", "tdpass")
    body = client.get(
        f"/tournaments/{td_tournament.id}/members/{m.id}/?surface=members_panel"
    ).json()
    assert len(body["lunch"]) == 1
    assert body["hidden_sections"] == []


# ---------------------------------------------------------------------------
# Columns and sections — write validation
# ---------------------------------------------------------------------------

def test_put_accepts_columns_and_sections(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    payload = {
        "members_table": {"hidden": [], "columns": ["email", "joined", "track:1"]},
        "members_panel": {"hidden": [], "sections": [
            {"id": "membership", "hidden": False, "hidden_fields": ["age"], "title": None, "fields": []},
            {"id": "custom:abc123", "hidden": False, "hidden_fields": [],
             "title": "Dietary Notes", "fields": ["form_field:xyz"]},
        ]},
    }
    response = client.put(f"/tournaments/{td_tournament.id}/display-config/", json=payload)
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["members_table"]["columns"] == ["email", "joined", "track:1"]
    assert body["members_panel"]["sections"][1]["title"] == "Dietary Notes"


def test_put_rejects_unknown_column(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_table": {"columns": ["not_a_column"]}},
    )
    assert response.status_code == 422
    assert "not_a_column" in response.json()["detail"]


def test_put_rejects_unknown_section(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_panel": {"sections": [{"id": "not_a_section"}]}},
    )
    assert response.status_code == 422


def test_put_rejects_duplicate_section(client, td_user, td_tournament):
    """Order is the array's own order, so a repeated id has no meaning."""
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_panel": {"sections": [{"id": "lunch"}, {"id": "lunch"}]}},
    )
    assert response.status_code == 422
    assert "Duplicate" in response.json()["detail"]


def test_put_rejects_field_not_in_its_section(client, td_user, td_tournament):
    """hidden_fields is checked against the section it's on — "shirt_size"
    belongs to Logistics, not Membership."""
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_panel": {"sections": [
            {"id": "membership", "hidden_fields": ["shirt_size"]},
        ]}},
    )
    assert response.status_code == 422
    assert "shirt_size" in response.json()["detail"]


def test_put_rejects_fields_on_a_builtin_section(client, td_user, td_tournament):
    """A built-in section's contents are fixed — accepting an assignment there
    would silently do nothing."""
    login(client, "td@test.com", "tdpass")
    response = client.put(
        f"/tournaments/{td_tournament.id}/display-config/",
        json={"members_panel": {"sections": [
            {"id": "lunch", "fields": ["form_field:xyz"]},
        ]}},
    )
    assert response.status_code == 422
    assert "built-in" in response.json()["detail"]


def test_section_fields_include_one_entry_per_entity(client, td_user, td_tournament, db):
    """A section's pieces are its static fields plus the entities it actually
    renders — one per track / lunch category, not a single all-or-nothing
    switch over the lot."""
    track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
    db.add(track)
    db.flush()
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u.id)
    db.add(TournamentMembershipLunch(
        membership_id=m.id, date=date(2026, 3, 1), category="entree", value="veggie", label="Veggie wrap",
    ))
    db.commit()

    login(client, "td@test.com", "tdpass")
    sections = {s["id"]: s for s in client.get(
        f"/tournaments/{td_tournament.id}/display-config/catalog/"
    ).json()["sections"]}

    main = next(t for t in td_tournament.tracks if t.name == "Main")
    assert [f["key"] for f in sections["membership"]["fields"]] == [
        "joined", "join_method", "roles", "age", f"track:{main.id}", f"track:{track.id}",
    ]
    assert [f["key"] for f in sections["lunch"]["fields"]] == [
        "dietary_restriction", "lunch_category:entree",
    ]
