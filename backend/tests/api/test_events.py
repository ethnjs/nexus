"""Tests for /tournaments/{tournament_id}/events endpoints."""
import pytest
from fastapi.testclient import TestClient
from tests.conftest import login
from app.models.models import Membership


def _make_event(client, tournament_id, **overrides):
    payload = {
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
        "blocks": [1, 2, 3, 4, 5, 6],
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
    assert data["volunteers_needed"] == 2


def test_create_event_full(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_event(client, td_tournament.id,
        name="Hovercraft", division="B", event_type="trial",
        category="Technology & Engineering", building="Main Hall",
        room="101", floor="1", volunteers_needed=3, blocks=[1, 2, 3],
    )
    assert response.status_code == 201
    data = response.json()
    assert data["category"] == "Technology & Engineering"
    assert data["volunteers_needed"] == 3
    assert data["event_type"] == "trial"


def test_create_event_duplicate_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_event(client, td_tournament.id)
    assert _make_event(client, td_tournament.id).status_code == 409


def test_create_event_tournament_id_mismatch(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/events/", json={
        "tournament_id": 9999,
        "name": "Boomilever",
        "division": "C",
        "blocks": [],
    })
    assert response.status_code == 400


def test_create_event_non_member_forbidden(client, td_user, other_tournament):
    """Non-members get 403 on write routes — permission check fires before existence check."""
    login(client, "td@test.com", "tdpass")
    assert _make_event(client, other_tournament.id).status_code == 403


def test_create_event_volunteer_member_forbidden(
    client, td_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
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


def test_list_events_view_events_permission_sufficient(
    client, td_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/events/").status_code == 200


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
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
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


def test_update_event_volunteer_cannot_patch(
    client, td_user, other_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
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