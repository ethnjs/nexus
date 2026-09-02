"""Tests for GET/PUT /tournaments/{tournament_id}/display-config/
(app/api/routes/tournament/display_config.py)."""
from datetime import date, datetime, timezone
from app.models.models import (
    Form, FormField, TournamentMembership, TournamentMembershipEventPreference,
    TournamentMembershipLunch, TournamentMembershipTrackStatus, TournamentTrack,
)
from tests.conftest import grant_role, login


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
    td_tournament.display_config = {
        "unknown_surface": {"hidden": ["track:999", "not_a_real_namespace:x"]},
    }
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/display-config/")
    assert response.status_code == 200
    assert response.json() == {"unknown_surface": {"hidden": ["track:999", "not_a_real_namespace:x"]}}


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
    assert response.json() == payload

    follow_up = client.get(f"/tournaments/{td_tournament.id}/display-config/")
    assert follow_up.json() == payload


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


def test_get_display_config_catalog_empty_tournament(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/display-config/catalog/")
    assert response.status_code == 200
    assert response.json() == {
        "tracks": [], "availability": [], "lunch_categories": [], "event_preferences": [],
        "custom_fields": [],
    }


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
        "tournament_id": td_tournament.id, "name": "Boomilever", "division": "C", "blocks": [1],
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
        TournamentShift(
            tournament_id=td_tournament.id, label="Morning",
            start=datetime(2026, 3, 1, 15, 0, tzinfo=timezone.utc),
            end=datetime(2026, 3, 1, 19, 0, tzinfo=timezone.utc),
        ),
        TournamentShift(
            tournament_id=td_tournament.id, label="Afternoon",
            start=datetime(2026, 3, 1, 20, 0, tzinfo=timezone.utc),
            end=datetime(2026, 3, 1, 23, 0, tzinfo=timezone.utc),
        ),
        TournamentShift(
            tournament_id=td_tournament.id, label="Day two",
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
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/{m.id}/")
    assert response.status_code == 200
    by_name = {t["name"]: t["status"] for t in response.json()["track_statuses"]}
    assert by_name == {"Answered Track": "confirmed", "Unanswered Track": "pending"}
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
        f"/tournaments/{td_tournament.id}/memberships/{m.id}/?surface=members_panel"
    )
    assert response.status_code == 200
    assert [t["name"] for t in response.json()["track_statuses"]] == ["Shown Track"]
