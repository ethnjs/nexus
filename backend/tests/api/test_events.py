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
    }
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/events/", json=payload)


def _make_block(client, tournament_id, **overrides):
    payload = {
        "label": "Block 1",
        "date": "2025-03-15",
        "start": "09:00",
        "end": "11:00",
    }
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/blocks/", json=payload)


def _get_seeded_category_id(client, tournament_id):
    """Return the id of the first seeded category for the given tournament."""
    categories = client.get(f"/tournaments/{tournament_id}/categories/").json()
    return next(c["id"] for c in categories if not c["is_custom"])


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
    assert data["time_blocks"] == []


def test_create_event_no_division(client, td_user, td_tournament):
    """division is nullable — non-SO events like impound slots have no division."""
    login(client, "td@test.com", "tdpass")
    response = _make_event(client, td_tournament.id, division=None)
    assert response.status_code == 201
    assert response.json()["division"] is None


def test_create_event_invalid_division(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert _make_event(client, td_tournament.id, division="A").status_code == 422


def test_create_event_full(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    cat_id = _get_seeded_category_id(client, td_tournament.id)
    block = _make_block(client, td_tournament.id).json()
    response = _make_event(
        client, td_tournament.id,
        name="Hovercraft", division="B", event_type="trial",
        category_id=cat_id, building="Main Hall",
        room="101", floor="1", volunteers_needed=3,
        time_block_ids=[block["id"]],
    )
    assert response.status_code == 201
    data = response.json()
    assert data["category_id"] == cat_id
    assert data["volunteers_needed"] == 3
    assert data["event_type"] == "trial"
    assert len(data["time_blocks"]) == 1
    assert data["time_blocks"][0]["id"] == block["id"]


def test_create_event_with_time_blocks(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    b1 = _make_block(client, td_tournament.id, label="Morning", start="09:00", end="11:00").json()
    b2 = _make_block(client, td_tournament.id, label="Afternoon", start="13:00", end="15:00").json()
    response = _make_event(client, td_tournament.id, time_block_ids=[b1["id"], b2["id"]])
    assert response.status_code == 201
    returned_ids = {b["id"] for b in response.json()["time_blocks"]}
    assert returned_ids == {b1["id"], b2["id"]}


def test_create_event_time_block_from_other_tournament_ignored(
    client, td_user, td_tournament, other_user, other_tournament, db
):
    """time_block_ids referencing another tournament's blocks are silently ignored."""
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["tournament_director"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    other_block = _make_block(client, other_tournament.id).json()
    response = _make_event(client, td_tournament.id, time_block_ids=[other_block["id"]])
    assert response.status_code == 201
    assert response.json()["time_blocks"] == []


def test_create_event_duplicate_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_event(client, td_tournament.id)
    assert _make_event(client, td_tournament.id).status_code == 409


def test_create_event_same_name_different_division_allowed(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert _make_event(client, td_tournament.id, name="Anatomy", division="B").status_code == 201
    assert _make_event(client, td_tournament.id, name="Anatomy", division="C").status_code == 201


def test_create_event_tournament_id_mismatch(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/events/", json={
        "tournament_id": 9999,
        "name": "Boomilever",
        "division": "C",
    })
    assert response.status_code == 400


def test_create_event_non_member_forbidden(client, td_user, other_tournament):
    """Non-members get 403 on write routes — permission check fires before existence check."""
    login(client, "td@test.com", "tdpass")
    assert _make_event(client, other_tournament.id).status_code == 403


def test_create_event_volunteer_member_forbidden(
    client, td_user, other_tournament, db
):
    """view_events only — cannot write events."""
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert _make_event(client, other_tournament.id).status_code == 403


def test_create_event_manage_tournament_implies_manage_events(
    client, td_user, other_tournament, db
):
    """manage_tournament implies manage_events via PERMISSION_IMPLICATIONS —
    a tournament_director on another tournament can manage its events."""
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["tournament_director"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert _make_event(client, other_tournament.id).status_code == 201


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


def test_list_events_filter_by_division(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_event(client, td_tournament.id, name="Anatomy", division="B")
    _make_event(client, td_tournament.id, name="Boomilever", division="C")
    response = client.get(f"/tournaments/{td_tournament.id}/events/?division=B")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Anatomy"


def test_list_events_filter_by_type(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_event(client, td_tournament.id, name="Anatomy", division="B", event_type="standard")
    _make_event(client, td_tournament.id, name="Boomilever", division="C", event_type="trial")
    response = client.get(f"/tournaments/{td_tournament.id}/events/?type=trial")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Boomilever"


def test_list_events_filter_by_category_id(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    categories = client.get(f"/tournaments/{td_tournament.id}/categories/").json()
    cat_a = categories[0]["id"]
    cat_b = categories[1]["id"]
    _make_event(client, td_tournament.id, name="Anatomy", division="B", category_id=cat_a)
    _make_event(client, td_tournament.id, name="Boomilever", division="C", category_id=cat_b)
    response = client.get(f"/tournaments/{td_tournament.id}/events/?category_id={cat_a}")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Anatomy"


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


def test_update_event_time_blocks(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    block = _make_block(client, td_tournament.id).json()
    event = _make_event(client, td_tournament.id).json()
    assert event["time_blocks"] == []

    response = client.patch(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/",
        json={"time_block_ids": [block["id"]]},
    )
    assert response.status_code == 200
    assert len(response.json()["time_blocks"]) == 1
    assert response.json()["time_blocks"][0]["id"] == block["id"]


def test_update_event_clear_time_blocks(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    block = _make_block(client, td_tournament.id).json()
    event = _make_event(client, td_tournament.id, time_block_ids=[block["id"]]).json()
    assert len(event["time_blocks"]) == 1

    response = client.patch(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/",
        json={"time_block_ids": []},
    )
    assert response.status_code == 200
    assert response.json()["time_blocks"] == []


def test_update_event_category_id(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    cat_id = _get_seeded_category_id(client, td_tournament.id)
    event = _make_event(client, td_tournament.id).json()
    assert event["category_id"] is None

    response = client.patch(
        f"/tournaments/{td_tournament.id}/events/{event['id']}/",
        json={"category_id": cat_id},
    )
    assert response.status_code == 200
    assert response.json()["category_id"] == cat_id


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
