"""Tests for /tournaments/{tournament_id}/shifts endpoints (TournamentShift model)
and event/shift attach-detach."""
from tests.conftest import grant_role, login


def _make_shift(client, tournament_id, **overrides):
    payload = {
        "label": "Shift 1",
        "start": "2026-03-14T08:00:00Z",
        "end": "2026-03-14T12:00:00Z",
    }
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/shifts/", json=payload)


def _make_event(client, tournament_id, **overrides):
    payload = {
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
        "start_time": "2026-03-14T08:00:00Z",
        "end_time": "2026-03-14T16:00:00Z",
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
    response = _make_shift(client, td_tournament.id, start="2026-03-14T12:00:00Z", end="2026-03-14T08:00:00Z")
    assert response.status_code == 422


def test_list_shifts(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_shift(client, td_tournament.id, label="Shift 1")
    _make_shift(client, td_tournament.id, label="Shift 2", start="2026-03-14T12:00:00Z", end="2026-03-14T16:00:00Z")
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
    event = _make_event(client, td_tournament.id, start_time="2026-03-14T08:00:00Z", end_time="2026-03-14T10:00:00Z")
    shift = _make_shift(client, td_tournament.id, start="2026-03-14T09:00:00Z", end="2026-03-14T11:00:00Z").json()
    response = client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift['id']}/"
    )
    assert response.status_code == 409


def test_attach_overlapping_shift_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, start_time="2026-03-14T08:00:00Z", end_time="2026-03-14T16:00:00Z")
    shift1 = _make_shift(client, td_tournament.id, start="2026-03-14T08:00:00Z", end="2026-03-14T12:00:00Z").json()
    shift2 = _make_shift(client, td_tournament.id, start="2026-03-14T11:00:00Z", end="2026-03-14T15:00:00Z").json()

    assert client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift1['id']}/"
    ).status_code == 201
    response = client.post(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/shifts/{shift2['id']}/"
    )
    assert response.status_code == 409


def test_attach_adjacent_shift_succeeds(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    event = _make_event(client, td_tournament.id, start_time="2026-03-14T08:00:00Z", end_time="2026-03-14T16:00:00Z")
    shift1 = _make_shift(client, td_tournament.id, start="2026-03-14T08:00:00Z", end="2026-03-14T12:00:00Z").json()
    shift2 = _make_shift(client, td_tournament.id, start="2026-03-14T12:00:00Z", end="2026-03-14T16:00:00Z").json()

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
