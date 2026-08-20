"""Tests for /tournaments/{tournament_id}/shifts endpoints (TournamentShift model)
and event/shift attach-detach."""
from datetime import date, timedelta

from tests.conftest import grant_role, login

from app.models.models import Form, FormField, TournamentMembership, TournamentMembershipAvailability

# td_tournament spans [today, today + 1 day] — event/shift times must fall
# within that window now that tournament-bounds validation exists.
EVENT_DATE = date.today().isoformat()
BEFORE_TOURNAMENT = (date.today() - timedelta(days=1)).isoformat()
AFTER_TOURNAMENT = (date.today() + timedelta(days=3)).isoformat()


def _make_shift(client, tournament_id, **overrides):
    payload = {
        "label": "Shift 1",
        "start": EVENT_DATE + "T08:00:00Z",
        "end": EVENT_DATE + "T12:00:00Z",
    }
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/shifts/", json=payload)


def _make_event(client, tournament_id, **overrides):
    payload = {
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
        "start_time": EVENT_DATE + "T08:00:00Z",
        "end_time": EVENT_DATE + "T16:00:00Z",
    }
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/events/", json=payload).json()


# ---------------------------------------------------------------------------
# Shift CRUD
# ---------------------------------------------------------------------------

def test_create_shift(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_shift(client, td_tournament.id)
    assert response.status_code == 201
    data = response.json()
    assert data["label"] == "Shift 1"
    assert data["tournament_id"] == td_tournament.id


def test_create_shift_end_before_start_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_shift(client, td_tournament.id, start=EVENT_DATE + "T12:00:00Z", end=EVENT_DATE + "T08:00:00Z")
    assert response.status_code == 422


def test_create_shift_before_tournament_start_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_shift(client, td_tournament.id, start=BEFORE_TOURNAMENT + "T08:00:00Z", end=BEFORE_TOURNAMENT + "T12:00:00Z")
    assert response.status_code == 409


def test_create_shift_after_tournament_end_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_shift(client, td_tournament.id, start=AFTER_TOURNAMENT + "T08:00:00Z", end=AFTER_TOURNAMENT + "T12:00:00Z")
    assert response.status_code == 409


def test_update_shift_outside_tournament_bounds_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_shift(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/shifts/{created['id']}/",
        json={"start": AFTER_TOURNAMENT + "T08:00:00Z", "end": AFTER_TOURNAMENT + "T12:00:00Z"},
    )
    assert response.status_code == 409


def test_list_shifts(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_shift(client, td_tournament.id, label="Shift 1")
    _make_shift(client, td_tournament.id, label="Shift 2", start=EVENT_DATE + "T12:00:00Z", end=EVENT_DATE + "T16:00:00Z")
    response = client.get(f"/tournaments/{td_tournament.id}/shifts/")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_update_shift(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_shift(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/shifts/{created['id']}/",
        json={"label": "Renamed Shift"},
    )
    assert response.status_code == 200
    assert response.json()["label"] == "Renamed Shift"


def test_shift_event_count(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    shift = _make_shift(client, td_tournament.id).json()
    assert shift["event_count"] == 0

    event1 = _make_event(client, td_tournament.id, name="Boomilever")
    event2 = _make_event(client, td_tournament.id, name="Hovercraft")
    client.post(f"/tournaments/{td_tournament.id}/events/{event1['id']}/shifts/{shift['id']}/")
    client.post(f"/tournaments/{td_tournament.id}/events/{event2['id']}/shifts/{shift['id']}/")

    listed = client.get(f"/tournaments/{td_tournament.id}/shifts/").json()
    assert next(s for s in listed if s["id"] == shift["id"])["event_count"] == 2


def test_delete_shift(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_shift(client, td_tournament.id).json()
    assert client.delete(f"/tournaments/{td_tournament.id}/shifts/{created['id']}/").status_code == 204


def test_delete_shift_attached_to_two_events_detaches_both(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    shift = _make_shift(client, td_tournament.id).json()
    event1 = _make_event(client, td_tournament.id, name="Boomilever")
    event2 = _make_event(client, td_tournament.id, name="Hovercraft")

    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event1['id']}/shifts/{shift['id']}/"
    ).status_code == 201
    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event2['id']}/shifts/{shift['id']}/"
    ).status_code == 201

    assert client.delete(f"/tournaments/{td_tournament.id}/shifts/{shift['id']}/").status_code == 204

    e1 = client.get(f"/tournaments/{td_tournament.id}/events/{event1['id']}/").json()
    e2 = client.get(f"/tournaments/{td_tournament.id}/events/{event2['id']}/").json()
    assert e1["shifts"] == []
    assert e2["shifts"] == []


def test_delete_shift_blocked_when_referenced_by_availability(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    shift = _make_shift(client, td_tournament.id).json()

    membership = (
        db.query(TournamentMembership)
        .filter(TournamentMembership.user_id == td_user.id, TournamentMembership.tournament_id == td_tournament.id)
        .first()
    )
    db.add(TournamentMembershipAvailability(membership_id=membership.id, tournament_shift_id=shift["id"]))
    db.commit()

    response = client.delete(f"/tournaments/{td_tournament.id}/shifts/{shift['id']}/")
    assert response.status_code == 409
    assert "1" in response.json()["detail"]

    # Not deleted.
    listed = client.get(f"/tournaments/{td_tournament.id}/shifts/").json()
    assert any(s["id"] == shift["id"] for s in listed)


def test_delete_shift_blocked_when_referenced_by_live_field_option(client, db, td_user, td_tournament):
    """Guard fires even with zero answers — a shift grouped into a live
    availability option can't be pulled out from under it, independent of
    the separate MembershipAvailability guard above."""
    login(client, "td@test.com", "tdpass")
    shift = _make_shift(client, td_tournament.id).json()

    form = Form(owner_type="tournament", tournament_id=td_tournament.id, name="Volunteer form", created_by=td_user.id)
    db.add(form)
    db.flush()
    db.add(FormField(
        form_id=form.id, order=1, label="Availability", field_key="availability",
        question_type="multi_select_checkbox",
        config={"options": [{"option_id": "opt_1", "value": [shift["id"]], "label": "All Day"}]},
        is_archived=False,
    ))
    db.commit()

    response = client.delete(f"/tournaments/{td_tournament.id}/shifts/{shift['id']}/")
    assert response.status_code == 409

    listed = client.get(f"/tournaments/{td_tournament.id}/shifts/").json()
    assert any(s["id"] == shift["id"] for s in listed)


def test_delete_shift_allowed_when_only_referenced_by_archived_field(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    shift = _make_shift(client, td_tournament.id).json()

    form = Form(owner_type="tournament", tournament_id=td_tournament.id, name="Old form", created_by=td_user.id)
    db.add(form)
    db.flush()
    db.add(FormField(
        form_id=form.id, order=1, label="Availability", field_key="availability_archived_1",
        question_type="multi_select_checkbox",
        config={"options": [{"option_id": "opt_1", "value": [shift["id"]], "label": "All Day"}]},
        is_archived=True,
    ))
    db.commit()

    assert client.delete(f"/tournaments/{td_tournament.id}/shifts/{shift['id']}/").status_code == 204


def test_shift_routes_require_manage_events(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/shifts/").status_code == 403


# ---------------------------------------------------------------------------
# Attach / detach
# ---------------------------------------------------------------------------

def test_attach_shift_success(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id)
    shift = _make_shift(client, td_tournament.id).json()
    response = client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift['id']}/"
    )
    assert response.status_code == 201
    updated_event = client.get(f"/tournaments/{td_tournament.id}/events/{event['id']}/").json()
    assert len(updated_event["shifts"]) == 1


def test_attach_shift_outside_event_bounds_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, start_time=EVENT_DATE + "T08:00:00Z", end_time=EVENT_DATE + "T10:00:00Z")
    shift = _make_shift(client, td_tournament.id, start=EVENT_DATE + "T09:00:00Z", end=EVENT_DATE + "T11:00:00Z").json()
    response = client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift['id']}/"
    )
    assert response.status_code == 409


def test_attach_shift_event_missing_times_rejected(client, td_user, td_tournament):
    """Event start_time/end_time are nullable at create time — but a shift
    can't be bounds-checked against an event that has neither set."""
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, start_time=None, end_time=None)
    shift = _make_shift(client, td_tournament.id).json()
    response = client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift['id']}/"
    )
    assert response.status_code == 409


def test_attach_overlapping_shift_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, start_time=EVENT_DATE + "T08:00:00Z", end_time=EVENT_DATE + "T16:00:00Z")
    shift1 = _make_shift(client, td_tournament.id, start=EVENT_DATE + "T08:00:00Z", end=EVENT_DATE + "T12:00:00Z").json()
    shift2 = _make_shift(client, td_tournament.id, start=EVENT_DATE + "T11:00:00Z", end=EVENT_DATE + "T15:00:00Z").json()

    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift1['id']}/"
    ).status_code == 201
    response = client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift2['id']}/"
    )
    assert response.status_code == 409


def test_attach_adjacent_shift_succeeds(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, start_time=EVENT_DATE + "T08:00:00Z", end_time=EVENT_DATE + "T16:00:00Z")
    shift1 = _make_shift(client, td_tournament.id, start=EVENT_DATE + "T08:00:00Z", end=EVENT_DATE + "T12:00:00Z").json()
    shift2 = _make_shift(client, td_tournament.id, start=EVENT_DATE + "T12:00:00Z", end=EVENT_DATE + "T16:00:00Z").json()

    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift1['id']}/"
    ).status_code == 201
    response = client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift2['id']}/"
    )
    assert response.status_code == 201


def test_same_shift_attached_to_multiple_events_succeeds(client, td_user, td_tournament):
    """Reuse case — a shift isn't scoped to a single event."""
    login(client, "td@test.com", "tdpass")
    shift = _make_shift(client, td_tournament.id).json()
    event1 = _make_event(client, td_tournament.id, name="Boomilever")
    event2 = _make_event(client, td_tournament.id, name="Hovercraft")

    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event1['id']}/shifts/{shift['id']}/"
    ).status_code == 201
    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event2['id']}/shifts/{shift['id']}/"
    ).status_code == 201


def test_detach_shift(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id)
    shift = _make_shift(client, td_tournament.id).json()
    client.post(f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift['id']}/")

    response = client.delete(f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift['id']}/")
    assert response.status_code == 204

    updated_event = client.get(f"/tournaments/{td_tournament.id}/events/{event['id']}/").json()
    assert updated_event["shifts"] == []
