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
        "start_time": EVENT_DATE + "T08:00:00Z",
        "end_time": EVENT_DATE + "T12:00:00Z",
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


def test_create_event_end_before_start_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_event(
        client, td_tournament.id,
        start_time=EVENT_DATE + "T12:00:00Z", end_time=EVENT_DATE + "T08:00:00Z",
    )
    assert response.status_code == 422


def test_create_event_start_before_tournament_start_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_event(client, td_tournament.id, start_time=BEFORE_TOURNAMENT + "T08:00:00Z")
    assert response.status_code == 409


def test_create_event_end_after_tournament_end_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_event(client, td_tournament.id, end_time=AFTER_TOURNAMENT + "T12:00:00Z")
    assert response.status_code == 409


def test_create_event_without_times_skips_bounds_check(client, td_user, td_tournament):
    """start_time/end_time are nullable — bounds only apply once set."""
    login(client, "td@test.com", "tdpass")
    response = _make_event(client, td_tournament.id, start_time=None, end_time=None)
    assert response.status_code == 201


def test_create_event_tournament_id_mismatch(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/events/", json={
        "tournament_id": 9999,
        "name": "Boomilever",
        "division": "C",
        "start_time": EVENT_DATE + "T08:00:00Z",
        "end_time": EVENT_DATE + "T12:00:00Z",
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


def test_update_event_end_before_start_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_event(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/events/{created['id']}/",
        json={"start_time": EVENT_DATE + "T12:00:00Z", "end_time": EVENT_DATE + "T08:00:00Z"},
    )
    assert response.status_code == 422


def test_update_event_outside_tournament_bounds_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_event(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/events/{created['id']}/",
        json={"start_time": BEFORE_TOURNAMENT + "T08:00:00Z"},
    )
    assert response.status_code == 409


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
# Membership event preferences — grouped read on memberships/me/ and
# memberships/{id}/. See app/schemas/tournament/membership.py's
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


def _add_preference(db, membership_id, key, event_id, rank):
    from app.models.models import TournamentMembershipEventPreference
    db.add(TournamentMembershipEventPreference(
        membership_id=membership_id, key=key, tournament_event_id=event_id, rank=rank,
    ))
    db.commit()



def _add_event_preference_field(db, tournament_id, created_by, key, options, field_archived=False):
    """A published tournament form carrying one event_preference_{key} field.
    `options` is [(option_id, label, [event ids], is_archived)] — the grouping
    build_event_preferences reverses when reading answers back."""
    from app.models.models import Form, FormField

    form = Form(
        name=f"form-{key}", title=f"Form {key}", owner_type="tournament",
        tournament_id=tournament_id, status="published", created_by=created_by,
    )
    db.add(form)
    db.flush()
    db.add(FormField(
        form_id=form.id, order=0, label=f"Events {key}",
        question_type="ranked_choice", field_key=f"event_preference_{key}",
        is_archived=field_archived,
        config={"options": [
            {"option_id": oid, "label": label, "value": ids, "is_archived": archived}
            for oid, label, ids, archived in options
        ]},
    ))
    db.commit()


def test_event_preferences_group_by_the_option_the_member_picked(client, db, td_user, td_tournament):
    """One option grouping several events reads back as one entry, not one per
    event — the whole point of the option-grouped shape."""
    login(client, "td@test.com", "tdpass")
    e1 = _make_event(client, td_tournament.id, name="Anatomy").json()
    e2 = _make_event(client, td_tournament.id, name="Astronomy").json()
    membership = _td_membership(db, td_user, td_tournament)
    _add_event_preference_field(
        db, td_tournament.id, td_user.id, "morning",
        [("opt_1", "Life & Space Science", [e1["id"], e2["id"]], False)],
    )
    _add_preference(db, membership.id, "morning", e1["id"], 1)
    _add_preference(db, membership.id, "morning", e2["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/memberships/{membership.id}/")
    assert res.status_code == 200
    options = res.json()["event_preferences"][0]["options"]
    assert len(options) == 1
    assert options[0]["label"] == "Life & Space Science"
    assert options[0]["is_archived"] is False
    assert [e["id"] for e in options[0]["events"]] == sorted([e1["id"], e2["id"]])


def test_event_preferences_flag_answers_to_an_archived_option(client, db, td_user, td_tournament):
    """An answer given before the TD reworked the question still renders, but
    is flagged so the panel can warn it's out of date."""
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, name="Anatomy").json()
    membership = _td_membership(db, td_user, td_tournament)
    _add_event_preference_field(
        db, td_tournament.id, td_user.id, "morning", [("opt_1", "Retired Group", [event["id"]], True)],
    )
    _add_preference(db, membership.id, "morning", event["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/memberships/{membership.id}/")
    assert res.status_code == 200
    option = res.json()["event_preferences"][0]["options"][0]
    assert option["label"] == "Retired Group"
    assert option["is_archived"] is True


def test_member_reads_their_own_event_preferences_grouped(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    e1 = _make_event(client, td_tournament.id, name="Anatomy").json()
    e2 = _make_event(client, td_tournament.id, name="Astronomy").json()
    membership = _td_membership(db, td_user, td_tournament)
    # Ranked entries deliberately out of order to check the response sorts.
    _add_preference(db, membership.id, "morning", e2["id"], 2)
    _add_preference(db, membership.id, "morning", e1["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/memberships/me/")
    assert res.status_code == 200
    # No form field defines these options, so each event is its own group,
    # labelled by the event and flagged archived (see build_event_preferences).
    assert res.json()["event_preferences"] == [{
        "key": "morning",
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
    login(client, "td@test.com", "tdpass")
    e1 = _make_event(client, td_tournament.id, name="Anatomy").json()
    e2 = _make_event(client, td_tournament.id, name="Astronomy").json()
    membership = _td_membership(db, td_user, td_tournament)
    # Inserted in reverse id order — checkbox rows carry no rank, so they
    # must fall back to ordering by event id.
    _add_preference(db, membership.id, "afternoon", e2["id"], None)
    _add_preference(db, membership.id, "afternoon", e1["id"], None)

    res = client.get(f"/tournaments/{td_tournament.id}/memberships/me/")
    assert res.status_code == 200
    ids = [o["events"][0]["id"] for o in res.json()["event_preferences"][0]["options"]]
    assert ids == sorted([e1["id"], e2["id"]])

def test_member_event_preferences_grouped_by_key_sorted(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id).json()
    membership = _td_membership(db, td_user, td_tournament)
    _add_preference(db, membership.id, "morning", event["id"], 1)
    _add_preference(db, membership.id, "afternoon", event["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/memberships/me/")
    assert res.status_code == 200
    assert [g["key"] for g in res.json()["event_preferences"]] == ["afternoon", "morning"]

def test_member_detail_carries_event_preferences(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, name="Anatomy").json()
    membership = _td_membership(db, td_user, td_tournament)
    _add_preference(db, membership.id, "morning", event["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/memberships/{membership.id}/")
    assert res.status_code == 200
    assert res.json()["event_preferences"] == [{
        "key": "morning",
        "options": [{
            "option_id": None, "label": "Anatomy", "rank": 1, "is_archived": True,
            "events": [{"id": event["id"], "name": "Anatomy", "division": "C", "rank": 1}],
        }],
    }]

def test_member_slim_response_has_no_event_preferences(client, db, td_user, td_tournament):
    """Roster/search stays unchanged — the grouped shape is a full-response-only field."""
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id).json()
    membership = _td_membership(db, td_user, td_tournament)
    _add_preference(db, membership.id, "morning", event["id"], 1)

    res = client.get(f"/tournaments/{td_tournament.id}/memberships/")
    assert res.status_code == 200
    assert "event_preferences" not in res.json()[0]
