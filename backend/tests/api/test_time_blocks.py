"""Tests for /tournaments/{tournament_id}/blocks endpoints."""
import pytest
from fastapi.testclient import TestClient
from tests.conftest import login
from app.models.models import Membership


def _make_block(client, tournament_id, **overrides):
    payload = {
        "label": "Block 1",
        "date": "2025-03-15",
        "start": "09:00",
        "end": "11:00",
    }
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/blocks/", json=payload)


def _make_event(client, tournament_id, **overrides):
    payload = {"tournament_id": tournament_id, "name": "Boomilever", "division": "C"}
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/events/", json=payload)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def test_create_block(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_block(client, td_tournament.id)
    assert response.status_code == 201
    data = response.json()
    assert data["label"] == "Block 1"
    assert data["date"] == "2025-03-15"
    assert data["start"] == "09:00"
    assert data["end"] == "11:00"
    assert data["tournament_id"] == td_tournament.id
    assert "id" in data


def test_create_block_invalid_date_format(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_block(client, td_tournament.id, date="15-03-2025")
    assert response.status_code == 422


def test_create_block_invalid_time_format(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = _make_block(client, td_tournament.id, start="9:00 AM")
    assert response.status_code == 422


def test_create_block_end_before_start_allowed(client, td_user, td_tournament):
    """Midnight-spanning blocks (e.g. 23:00–01:00) are explicitly permitted."""
    login(client, "td@test.com", "tdpass")
    response = _make_block(client, td_tournament.id, start="23:00", end="01:00")
    assert response.status_code == 201


def test_create_block_requires_manage_events(client, td_user, other_tournament, db):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert _make_block(client, other_tournament.id).status_code == 403


def test_create_block_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert _make_block(client, other_tournament.id).status_code == 404


def test_create_block_unauthenticated(client, td_tournament):
    assert _make_block(client, td_tournament.id).status_code == 401


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def test_list_blocks(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_block(client, td_tournament.id, label="Block A")
    _make_block(client, td_tournament.id, label="Block B", start="11:00", end="13:00")
    response = client.get(f"/tournaments/{td_tournament.id}/blocks/")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_list_blocks_ordered_by_date_then_start(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    _make_block(client, td_tournament.id, label="Day2 Morning", date="2025-03-16", start="09:00", end="11:00")
    _make_block(client, td_tournament.id, label="Day1 Afternoon", date="2025-03-15", start="13:00", end="15:00")
    _make_block(client, td_tournament.id, label="Day1 Morning", date="2025-03-15", start="09:00", end="11:00")
    labels = [b["label"] for b in client.get(f"/tournaments/{td_tournament.id}/blocks/").json()]
    assert labels == ["Day1 Morning", "Day1 Afternoon", "Day2 Morning"]


def test_list_blocks_view_events_permission_sufficient(
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
    assert client.get(f"/tournaments/{other_tournament.id}/blocks/").status_code == 200


def test_list_blocks_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/blocks/").status_code == 404


# ---------------------------------------------------------------------------
# PATCH
# ---------------------------------------------------------------------------

def test_update_block(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_block(client, td_tournament.id).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/blocks/{created['id']}/",
        json={"label": "Impound", "start": "08:00"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["label"] == "Impound"
    assert data["start"] == "08:00"
    assert data["end"] == "11:00"  # unchanged


def test_update_block_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.patch(
        f"/tournaments/{td_tournament.id}/blocks/9999/", json={"label": "X"}
    ).status_code == 404


def test_update_block_wrong_tournament_404(
    client, td_user, td_tournament, other_user, other_tournament, db
):
    """A block belonging to tournament A is not reachable via tournament B's URL."""
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["tournament_director"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    block = _make_block(client, td_tournament.id).json()
    assert client.patch(
        f"/tournaments/{other_tournament.id}/blocks/{block['id']}/",
        json={"label": "X"},
    ).status_code == 404


def test_update_block_requires_manage_events(client, td_user, other_tournament, db):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert client.patch(
        f"/tournaments/{other_tournament.id}/blocks/1/", json={"label": "X"}
    ).status_code == 403


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------

def test_delete_block(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    created = _make_block(client, td_tournament.id).json()
    assert client.delete(
        f"/tournaments/{td_tournament.id}/blocks/{created['id']}/"
    ).status_code == 204
    blocks = client.get(f"/tournaments/{td_tournament.id}/blocks/").json()
    assert not any(b["id"] == created["id"] for b in blocks)


def test_delete_block_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/blocks/9999/").status_code == 404


def test_delete_block_with_events_returns_409(client, td_user, td_tournament):
    """Deleting a block that has assigned events must return 409 with affected_events."""
    login(client, "td@test.com", "tdpass")
    block = _make_block(client, td_tournament.id).json()
    event = _make_event(
        client, td_tournament.id, time_block_ids=[block["id"]]
    ).json()

    response = client.delete(f"/tournaments/{td_tournament.id}/blocks/{block['id']}/")
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "affected_events" in detail
    affected_ids = [e["id"] for e in detail["affected_events"]]
    assert event["id"] in affected_ids


def test_delete_block_requires_manage_events(client, td_user, other_tournament, db):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    login(client, "td@test.com", "tdpass")
    assert client.delete(
        f"/tournaments/{other_tournament.id}/blocks/1/"
    ).status_code == 403


# ---------------------------------------------------------------------------
# Overlap validation
# ---------------------------------------------------------------------------

def test_create_block_overlap_returns_409(client, td_user, td_tournament):
    """Creating a block whose time range overlaps an existing block returns 409."""
    login(client, "td@test.com", "tdpass")
    _make_block(client, td_tournament.id, start="09:00", end="11:00")
    response = _make_block(client, td_tournament.id, start="10:00", end="12:00")
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "conflict" in detail
    assert detail["conflict"]["start"] == "09:00"


def test_create_block_adjacent_allowed(client, td_user, td_tournament):
    """Blocks that share only an endpoint (end == other.start) do not overlap."""
    login(client, "td@test.com", "tdpass")
    _make_block(client, td_tournament.id, start="09:00", end="11:00")
    response = _make_block(client, td_tournament.id, label="Block 2", start="11:00", end="13:00")
    assert response.status_code == 201


def test_patch_block_to_overlap_returns_409(client, td_user, td_tournament):
    """PATCHing a block so it overlaps another block returns 409."""
    login(client, "td@test.com", "tdpass")
    _make_block(client, td_tournament.id, label="Block 1", start="09:00", end="11:00")
    b2 = _make_block(client, td_tournament.id, label="Block 2", start="13:00", end="15:00").json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/blocks/{b2['id']}/",
        json={"start": "10:00", "end": "14:00"},
    )
    assert response.status_code == 409
    assert "conflict" in response.json()["detail"]


def test_patch_block_self_exclusion_allowed(client, td_user, td_tournament):
    """PATCHing a block with only label/non-time changes does not conflict with itself."""
    login(client, "td@test.com", "tdpass")
    block = _make_block(client, td_tournament.id, start="09:00", end="11:00").json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/blocks/{block['id']}/",
        json={"label": "Renamed Block"},
    )
    assert response.status_code == 200
    assert response.json()["label"] == "Renamed Block"


def test_create_midnight_spanning_block_allowed(client, td_user, td_tournament):
    """A midnight-spanning block (end < start) that does not overlap anything is allowed."""
    login(client, "td@test.com", "tdpass")
    response = _make_block(client, td_tournament.id, start="22:00", end="00:30")
    assert response.status_code == 201


def test_create_block_overlapping_midnight_spanning_returns_409(client, td_user, td_tournament):
    """A block that falls within the range of a midnight-spanning block returns 409."""
    login(client, "td@test.com", "tdpass")
    _make_block(client, td_tournament.id, label="Late Block", start="23:00", end="01:00")
    # 00:00–00:30 falls inside 23:00–01:00 (normalized 23:00–25:00)
    response = _make_block(client, td_tournament.id, label="Overlap Block", start="00:00", end="00:30")
    assert response.status_code == 409
