"""Tests for /tournaments/{tournament_id}/events endpoints (TournamentEvent model)."""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from tests.conftest import grant_role, login

# td_tournament spans [today, today + 1 day] — event/shift times must fall
# within that window now that tournament-bounds validation exists.
EVENT_DATE = date.today().isoformat()
BEFORE_TOURNAMENT = (date.today() - timedelta(days=1)).isoformat()
AFTER_TOURNAMENT = (date.today() + timedelta(days=3)).isoformat()


def _make_event(client, tournament_id, **overrides):
    payload = {
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
    }
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/events/", json=payload)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def test_create_event_minimal(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_event(client, td_tournament.id)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Boomilever"
    assert data["division"] == "C"
    assert data["tournament_id"] == td_tournament.id
    assert data["event_type"] == "standard"
    assert data["volunteers_needed"] is None


def test_create_event_full(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_event(client, td_tournament.id,
        name="Hovercraft", division="B", event_type="trial",
        building="Main Hall", room="101", floor="1", volunteers_needed=3,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["volunteers_needed"] == 3
    assert data["event_type"] == "trial"


def test_create_event_with_catalog_link_inherits_category(client, td_user, td_tournament, event):
    """Setting event_id joins the canonical Event — category comes from
    the join, not a column on TournamentEvent."""
    login(client, "td@test.com", "tdpass")
    response = _make_event(client, td_tournament.id, name=None, event_id=event.id)
    assert response.status_code == 201
    data = response.json()
    assert data["event_id"] == event.id
    assert data["event"]["category"]["name"] == event.category.name


def test_create_event_without_catalog_link_has_no_category(client, td_user, td_tournament):
    """Custom (event_id-less) events have no category — nothing fabricated."""
    login(client, "td@test.com", "tdpass")
    response = _make_event(client, td_tournament.id)
    assert response.status_code == 201
    assert response.json()["event"] is None


def test_create_event_duplicate_catalog_division_rejected(client, td_user, td_tournament, event):
    login(client, "td@test.com", "tdpass")
    first = _make_event(client, td_tournament.id, name=None, event_id=event.id, division="C")
    assert first.status_code == 201
    second = _make_event(client, td_tournament.id, name=None, event_id=event.id, division="C")
    assert second.status_code == 409


def test_create_event_two_custom_events_same_name_both_succeed(client, td_user, td_tournament):
    """Custom events have no uniqueness constraint at all."""
    login(client, "td@test.com", "tdpass")
    first = _make_event(client, td_tournament.id, name="Boomilever", division="C")
    second = _make_event(client, td_tournament.id, name="Boomilever", division="C")
    assert first.status_code == 201
    assert second.status_code == 201


def test_create_event_division_not_in_tournament_divisions(client, td_user, td_tournament):
    """td_tournament only supports divisions B/C."""
    login(client, "td@test.com", "tdpass")
    response = _make_event(client, td_tournament.id, division="A")
    assert response.status_code == 422


def test_create_event_has_no_times_of_its_own(client, td_user, td_tournament):
    """An event's schedule is the union of its shifts. It has no start_time or
    end_time to be out of bounds, so there is no bounds check here at all —
    each shift is bounded by its own track's range instead (test_shifts.py).

    That also closes a hole the old check couldn't: an event on a gap day
    between two tracks passed the tournament-wide span. No shift can exist on
    a gap day, so it is now unreachable rather than merely discouraged."""
    login(client, "td@test.com", "tdpass")
    body = _make_event(client, td_tournament.id).json()
    assert body["days"] == []
    assert "start_time" not in body and "end_time" not in body


def test_create_event_rejects_the_old_time_fields(client, td_user, td_tournament):
    """A caller still sending times gets a 422 rather than a silent drop."""
    login(client, "td@test.com", "tdpass")
    assert _make_event(
        client, td_tournament.id, start_time=EVENT_DATE + "T08:00:00Z",
    ).status_code == 422


def test_create_event_with_tracks(client, td_user, td_tournament):
    """The Test Writing case: an event on a track that has no shifts at all."""
    login(client, "td@test.com", "tdpass")
    track = client.post(
        f"/tournaments/{td_tournament.id}/tracks/", json={"name": "Test Writing"},
    ).json()
    body = _make_event(client, td_tournament.id, track_ids=[track["id"]]).json()
    assert body["track_ids"] == [track["id"]]


def test_create_event_with_unknown_track_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert _make_event(client, td_tournament.id, track_ids=[9999]).status_code == 422


def test_create_event_tournament_id_mismatch(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/events/", json={
        "tournament_id": 9999,
        "name": "Boomilever",
        "division": "C",
    })
    assert response.status_code == 400


def test_create_event_non_member_forbidden(client, td_user, other_tournament):
    """Non-members get 404 — membership existence check fires before permission."""
    login(client, "td@test.com", "tdpass")
    assert _make_event(client, other_tournament.id).status_code == 404


def test_create_event_volunteer_member_forbidden(
    client, td_user, other_tournament, db
):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert _make_event(client, other_tournament.id).status_code == 403


def test_create_event_unauthenticated(client, td_tournament):
    assert _make_event(client, td_tournament.id).status_code == 401


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def test_list_events(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_event(client, td_tournament.id, name="Boomilever", division="C")
    _make_event(client, td_tournament.id, name="Hovercraft", division="C")
    response = client.get(f"/tournaments/{td_tournament.id}/events/")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_list_events_ordered_by_division_name(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_event(client, td_tournament.id, name="Hovercraft", division="C")
    _make_event(client, td_tournament.id, name="Boomilever", division="C")
    _make_event(client, td_tournament.id, name="Anatomy", division="B")
    names = [e["name"] for e in client.get(f"/tournaments/{td_tournament.id}/events/").json()]
    assert names[0] == "Anatomy"
    assert names[1] == "Boomilever"
    assert names[2] == "Hovercraft"


def test_list_events_requires_manage_events(
    client, td_user, other_tournament, db
):
    """There's no separate read-only view_events tier — listing requires
    manage_events, same as write. A no-permission role is forbidden."""
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/events/").status_code == 403


def test_list_events_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/events/").status_code == 404


# ---------------------------------------------------------------------------
# ?public=true — the member-facing read
# ---------------------------------------------------------------------------

def test_list_events_public_readable_by_plain_member(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/events/?public=true").status_code == 200


def test_list_events_public_omits_location_and_staffing(client, td_user, td_tournament):
    """Room assignment stays staff-side until the day, and volunteers_needed
    is a planning target — the member shape is only what names an event."""
    login(client, "td@test.com", "tdpass")
    _make_event(
        client, td_tournament.id, name="Boomilever", division="C",
        building="Science Hall", room="204", floor="2", volunteers_needed=6,
    )
    rows = client.get(f"/tournaments/{td_tournament.id}/events/?public=true").json()
    assert set(rows[0]) == {"id", "name", "division"}


def test_list_events_public_uses_display_name_for_catalog_events(
    client, td_user, td_tournament, db,
):
    """A catalog-linked event leaves its own name column null and carries the
    name on the joined canonical event — the member read has to resolve it."""
    from app.models.models import Event, EventCategory, TournamentEvent

    category = EventCategory(name="Build")
    db.add(category)
    db.flush()
    canonical = Event(name="Air Trajectory", category_id=category.id)
    db.add(canonical)
    db.flush()
    db.add(TournamentEvent(
        tournament_id=td_tournament.id, name=None, division="C", event_id=canonical.id,
    ))
    db.commit()

    login(client, "td@test.com", "tdpass")
    rows = client.get(f"/tournaments/{td_tournament.id}/events/?public=true").json()
    assert rows[0]["name"] == "Air Trajectory"


def test_list_events_public_still_requires_membership(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/events/?public=true").status_code == 404


def test_list_events_public_false_still_gates_the_permission(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/events/?public=false").status_code == 403


# ---------------------------------------------------------------------------
# Get single
# ---------------------------------------------------------------------------

def test_get_event(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_event(client, td_tournament.id).json()
    response = client.get(f"/tournaments/{td_tournament.id}/events/{created['id']}/")
    assert response.status_code == 200
    assert response.json()["name"] == "Boomilever"


def test_get_event_wrong_tournament_404(
    client, td_user, td_tournament, other_user, other_tournament, db
):
    grant_role(db, other_tournament, td_user, "Test Coordinator")
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id).json()
    assert client.get(
        f"/tournaments/{other_tournament.id}/events/{event['id']}/"
    ).status_code == 404


def test_get_event_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{td_tournament.id}/events/9999/").status_code == 404


# ---------------------------------------------------------------------------
# PATCH
# ---------------------------------------------------------------------------

def test_update_event(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_event(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/events/{created['id']}/",
        json={"building": "Science Hall", "room": "204"},
    )
    assert response.status_code == 200
    assert response.json()["building"] == "Science Hall"


def test_update_event_division_not_in_tournament_divisions(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_event(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/events/{created['id']}/",
        json={"division": "A"},
    )
    assert response.status_code == 422


def test_update_event_rejects_the_old_time_fields(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_event(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/events/{created['id']}/",
        json={"start_time": EVENT_DATE + "T12:00:00Z"},
    )
    assert response.status_code == 422


def test_update_event_replaces_the_whole_track_set(client, td_user, td_tournament):
    """track_ids is whole-set, not additive — a PATCH says what the event's
    tracks *are*."""
    login(client, "td@test.com", "tdpass")
    first = client.post(
        f"/tournaments/{td_tournament.id}/tracks/", json={"name": "Test Writing"},
    ).json()
    second = client.post(
        f"/tournaments/{td_tournament.id}/tracks/", json={"name": "Test Review"},
    ).json()
    created = _make_event(client, td_tournament.id, track_ids=[first["id"]]).json()

    body = client.patch(
        f"/tournaments/{td_tournament.id}/events/{created['id']}/",
        json={"track_ids": [second["id"]]},
    ).json()
    assert body["track_ids"] == [second["id"]]


def test_update_event_volunteer_cannot_patch(
    client, td_user, other_user, other_tournament, db
):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "other@test.com", "otherpass")
    event = _make_event(client, other_tournament.id).json()
    login(client, "td@test.com", "tdpass")
    assert client.patch(
        f"/tournaments/{other_tournament.id}/events/{event['id']}/",
        json={"room": "999"},
    ).status_code == 403


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------

def test_delete_event(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_event(client, td_tournament.id).json()
    assert client.delete(
        f"/tournaments/{td_tournament.id}/events/{created['id']}/"
    ).status_code == 204
    assert client.get(
        f"/tournaments/{td_tournament.id}/events/{created['id']}/"
    ).status_code == 404


def test_delete_event_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/events/9999/").status_code == 404


# ---------------------------------------------------------------------------
# Membership event preferences — grouped read on members/me/ and
# members/{id}/. See app/schemas/tournament/membership.py's
# MembershipEventPreferenceRead.
# ---------------------------------------------------------------------------

def _td_membership(db, td_user, td_tournament):
    from app.models.models import TournamentMembership
    return (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == td_user.id,
            TournamentMembership.tournament_id == td_tournament.id,
        )
        .one()
    )


def _add_preference(db, membership_id, track_id, event_id, rank):
    from app.models.models import TournamentMembershipEventPreference
    db.add(TournamentMembershipEventPreference(
        membership_id=membership_id, track_id=track_id, tournament_event_id=event_id, rank=rank,
    ))
    db.commit()


def _pref_track(db, tournament, name):
    """A track to scope preferences by. Cosmetic — these tests only need
    somewhere for the rows to hang off, and Test Writing is the real case
    for a track with no shifts of its own."""
    from app.models.models import TournamentTrack

    track = TournamentTrack(tournament_id=tournament.id, name=name)
    db.add(track)
    db.commit()
    return track.id



def _add_event_preference_field(db, tournament_id, created_by, track_id, options, field_archived=False):
    """A published tournament form carrying one event_preference_{track} field.
    `options` is [(option_id, label, [event ids], is_archived)] — the grouping
    build_event_preferences reverses when reading answers back."""
    from app.models.models import Form, FormField

    form = Form(
        name=f"form-{track_id}", title=f"Form {track_id}", owner_type="tournament",
        tournament_id=tournament_id, status="published", created_by=created_by,
    )
    db.add(form)
    db.flush()
    db.add(FormField(
        form_id=form.id, order=0, label=f"Events {track_id}",
        question_type="ranked_choice", field_key=f"event_preference_{track_id}",
        is_archived=field_archived,
        config={"options": [
            {"option_id": oid, "label": label, "value": ids, "is_archived": archived}
            for oid, label, ids, archived in options
        ]},
    ))
    db.commit()


def test_event_preferences_group_by_the_option_the_member_picked(client, db, td_user, td_tournament):
    morning_track = _pref_track(db, td_tournament, "Morning")
    """One option grouping several events reads back as one entry, not one per
    event — the whole point of the option-grouped shape."""
    login(client, "td@test.com", "tdpass")
    e1 = _make_event(client, td_tournament.id, name="Anatomy").json()
    e2 = _make_event(client, td_tournament.id, name="Astronomy").json()
    membership = _td_membership(db, td_user, td_tournament)
    _add_event_preference_field(
        db, td_tournament.id, td_user.id, morning_track,
        [("opt_1", "Life & Space Science", [e1["id"], e2["id"]], False)],
    )
    _add_preference(db, membership.id, morning_track, e1["id"], 1)
    _add_preference(db, membership.id, morning_track, e2["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/members/{membership.id}/")
    assert res.status_code == 200
    options = res.json()["event_preferences"][0]["options"]
    assert len(options) == 1
    assert options[0]["label"] == "Life & Space Science"
    assert options[0]["is_archived"] is False
    assert [e["id"] for e in options[0]["events"]] == sorted([e1["id"], e2["id"]])


def test_event_preferences_flag_answers_to_an_archived_option(client, db, td_user, td_tournament):
    morning_track = _pref_track(db, td_tournament, "Morning")
    """An answer given before the TD reworked the question still renders, but
    is flagged so the panel can warn it's out of date."""
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, name="Anatomy").json()
    membership = _td_membership(db, td_user, td_tournament)
    _add_event_preference_field(
        db, td_tournament.id, td_user.id, morning_track, [("opt_1", "Retired Group", [event["id"]], True)],
    )
    _add_preference(db, membership.id, morning_track, event["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/members/{membership.id}/")
    assert res.status_code == 200
    option = res.json()["event_preferences"][0]["options"][0]
    assert option["label"] == "Retired Group"
    assert option["is_archived"] is True


def test_member_reads_their_own_event_preferences_grouped(client, db, td_user, td_tournament):
    morning_track = _pref_track(db, td_tournament, "Morning")
    login(client, "td@test.com", "tdpass")
    e1 = _make_event(client, td_tournament.id, name="Anatomy").json()
    e2 = _make_event(client, td_tournament.id, name="Astronomy").json()
    membership = _td_membership(db, td_user, td_tournament)
    # Ranked entries deliberately out of order to check the response sorts.
    _add_preference(db, membership.id, morning_track, e2["id"], 2)
    _add_preference(db, membership.id, morning_track, e1["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/members/me/")
    assert res.status_code == 200
    # No form field defines these options, so each event is its own group,
    # labelled by the event and flagged archived (see build_event_preferences).
    assert res.json()["event_preferences"] == [{
        "track_id": morning_track,
        "track_name": "Morning",
        "options": [
            {
                "option_id": None, "label": "Anatomy", "rank": 1, "is_archived": True,
                "events": [{"id": e1["id"], "name": "Anatomy", "division": "C", "rank": 1}],
            },
            {
                "option_id": None, "label": "Astronomy", "rank": 2, "is_archived": True,
                "events": [{"id": e2["id"], "name": "Astronomy", "division": "C", "rank": 2}],
            },
        ],
    }]

def test_member_event_preferences_unranked_ordered_by_event_id(client, db, td_user, td_tournament):
    afternoon_track = _pref_track(db, td_tournament, "Afternoon")
    login(client, "td@test.com", "tdpass")
    e1 = _make_event(client, td_tournament.id, name="Anatomy").json()
    e2 = _make_event(client, td_tournament.id, name="Astronomy").json()
    membership = _td_membership(db, td_user, td_tournament)
    # Inserted in reverse id order — checkbox rows carry no rank, so they
    # must fall back to ordering by event id.
    _add_preference(db, membership.id, afternoon_track, e2["id"], None)
    _add_preference(db, membership.id, afternoon_track, e1["id"], None)

    res = client.get(f"/tournaments/{td_tournament.id}/members/me/")
    assert res.status_code == 200
    ids = [o["events"][0]["id"] for o in res.json()["event_preferences"][0]["options"]]
    assert ids == sorted([e1["id"], e2["id"]])

def test_member_event_preferences_grouped_by_key_sorted(client, db, td_user, td_tournament):
    morning_track = _pref_track(db, td_tournament, "Morning")
    afternoon_track = _pref_track(db, td_tournament, "Afternoon")
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id).json()
    membership = _td_membership(db, td_user, td_tournament)
    _add_preference(db, membership.id, morning_track, event["id"], 1)
    _add_preference(db, membership.id, afternoon_track, event["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/members/me/")
    assert res.status_code == 200
    assert [g["track_name"] for g in res.json()["event_preferences"]] == ["Afternoon", "Morning"]

def test_member_detail_carries_event_preferences(client, db, td_user, td_tournament):
    morning_track = _pref_track(db, td_tournament, "Morning")
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, name="Anatomy").json()
    membership = _td_membership(db, td_user, td_tournament)
    _add_preference(db, membership.id, morning_track, event["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/members/{membership.id}/")
    assert res.status_code == 200
    assert res.json()["event_preferences"] == [{
        "track_id": morning_track,
        "track_name": "Morning",
        "options": [{
            "option_id": None, "label": "Anatomy", "rank": 1, "is_archived": True,
            "events": [{"id": event["id"], "name": "Anatomy", "division": "C", "rank": 1}],
        }],
    }]

def test_roster_omits_event_preferences_unless_asked_for(client, db, td_user, td_tournament):
    morning_track = _pref_track(db, td_tournament, "Morning")
    """The roster used to be a narrower schema that simply had no such field.
    It is the same schema as the detail view now, so what keeps a whole
    tournament's event preferences off a roster is the caller not asking:
    a surface resolves to the groups its columns need, and no default column
    reads them."""
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id).json()
    membership = _td_membership(db, td_user, td_tournament)
    _add_preference(db, membership.id, morning_track, event["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/members/?surface=members_table")
    assert res.status_code == 200
    assert "event_preferences" not in res.json()[0]


def test_roster_returns_event_preferences_when_asked_for(client, db, td_user, td_tournament):
    morning_track = _pref_track(db, td_tournament, "Morning")
    """The other half: one response shape, narrowed by the caller, so the
    roster can serve them too rather than needing the detail route.

    Deliberately a separate test rather than a second request in the one
    above. The test client shares a single session across requests, so a
    prior request's noload() leaves event_preferences already-loaded-as-empty
    on the identity-mapped instance, and a later selectinload won't overwrite
    an attribute that is already populated. Per-request sessions in
    production make that impossible; two tests keep it out of the way here."""
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id).json()
    membership = _td_membership(db, td_user, td_tournament)
    _add_preference(db, membership.id, morning_track, event["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/members/?fields=event_prefs")
    row = next(r for r in res.json() if r["id"] == membership.id)
    assert [group["track_name"] for group in row["event_preferences"]] == ["Morning"]

