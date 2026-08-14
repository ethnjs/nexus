"""Tests for /tournaments/{tournament_id}/events endpoints (TournamentEvent model)."""
import pytest
from fastapi.testclient import TestClient
from tests.conftest import grant_role, login


def _make_event(client, tournament_id, **overrides):
    payload = {
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
        "start_time": "2026-03-14T08:00:00Z",
        "end_time": "2026-03-14T12:00:00Z",
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
        start_time="2026-03-14T12:00:00Z", end_time="2026-03-14T08:00:00Z",
    )
    assert response.status_code == 422


def test_create_event_tournament_id_mismatch(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/events/", json={
        "tournament_id": 9999,
        "name": "Boomilever",
        "division": "C",
        "start_time": "2026-03-14T08:00:00Z",
        "end_time": "2026-03-14T12:00:00Z",
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
        json={"start_time": "2026-03-14T12:00:00Z", "end_time": "2026-03-14T08:00:00Z"},
    )
    assert response.status_code == 422


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
