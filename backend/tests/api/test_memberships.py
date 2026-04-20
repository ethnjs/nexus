"""Tests for /tournaments/{tournament_id}/memberships endpoints."""
import pytest
from fastapi.testclient import TestClient
from tests.conftest import login
from app.models.models import Membership


def _make_user(db, email="alice@example.com"):
    """Create a user directly in the DB — bypasses the admin-only POST /users/ route."""
    from app.models.models import User as UserModel
    user = UserModel(first_name="Alice", last_name="Smith", email=email)
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "email": user.email}


def _make_block(client, tournament_id, label="Block 1", start="09:00", end="11:00"):
    return client.post(f"/tournaments/{tournament_id}/blocks/", json={
        "label": label, "date": "2025-03-15", "start": start, "end": end,
    }).json()


def _make_membership(client, tournament_id, user_id, **overrides):
    payload = {"user_id": user_id, "tournament_id": tournament_id, "status": "interested"}
    payload.update(overrides)
    return client.post(f"/tournaments/{tournament_id}/memberships/", json=payload)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def test_create_membership_minimal(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    response = _make_membership(client, td_tournament.id, u["id"])
    assert response.status_code == 201
    data = response.json()
    assert data["user_id"] == u["id"]
    assert data["tournament_id"] == td_tournament.id
    assert data["status"] == "interested"
    assert data["positions"] is None
    assert data["schedule"] is None


def test_create_membership_with_positions(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    response = _make_membership(
        client, td_tournament.id, u["id"],
        positions=["lead_event_supervisor", "test_writer"],
    )
    assert response.status_code == 201
    assert response.json()["positions"] == ["lead_event_supervisor", "test_writer"]


def test_create_membership_with_schedule(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    b1 = _make_block(client, td_tournament.id, label="Block 1", start="09:00", end="11:00")
    b2 = _make_block(client, td_tournament.id, label="Block 2", start="11:00", end="13:00")
    response = _make_membership(
        client, td_tournament.id, u["id"],
        schedule=[
            {"time_block_id": b1["id"], "duty": "event_supervisor"},
            {"time_block_id": b2["id"], "duty": "scoring"},
        ],
    )
    assert response.status_code == 201
    schedule = response.json()["schedule"]
    assert len(schedule) == 2
    assert schedule[1]["duty"] == "scoring"
    assert schedule[1]["time_block_id"] == b2["id"]


def test_create_membership_full(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    block = _make_block(client, td_tournament.id)
    response = _make_membership(
        client, td_tournament.id, u["id"],
        status="assigned",
        positions=["lead_event_supervisor"],
        schedule=[{"time_block_id": block["id"], "duty": "event_supervisor"}],
        role_preference=["event_volunteer"],
        event_preference=["Boomilever"],
        availability=[{"date": "2026-05-21", "start": "08:00", "end": "10:00"}],
        lunch_order="Veggie Wrap",
        notes="Allergic to nuts",
        extra_data={"transportation": "Driving", "general_volunteer_interest": ["STEM Expo"]},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["positions"] == ["lead_event_supervisor"]
    assert data["extra_data"]["transportation"] == "Driving"
    assert data["extra_data"]["general_volunteer_interest"] == ["STEM Expo"]


def test_create_membership_tournament_id_mismatch(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/memberships/",
        json={"user_id": u["id"], "tournament_id": 9999, "status": "interested"},
    )
    assert response.status_code == 400


def test_create_membership_invalid_user(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert _make_membership(client, td_tournament.id, 9999).status_code == 404


def test_create_membership_duplicate(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    _make_membership(client, td_tournament.id, u["id"])
    assert _make_membership(client, td_tournament.id, u["id"]).status_code == 409


def test_create_membership_invalid_status(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    assert _make_membership(
        client, td_tournament.id, u["id"], status="fake_status"
    ).status_code == 422


def test_create_membership_non_member_forbidden(client, td_user, other_tournament, db):
    """Non-members get 403 on write routes — permission check fires before existence check."""
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    assert _make_membership(client, other_tournament.id, u["id"]).status_code == 403


def test_create_membership_volunteer_member_forbidden(
    client, td_user, other_tournament, db
):
    db.add(Membership(
        user_id=td_user.id,
        tournament_id=other_tournament.id,
        positions=["event_supervisor"],
        status="confirmed",
    ))
    db.commit()
    u = _make_user(db, "newvolunteer@example.com")
    login(client, "td@test.com", "tdpass")
    assert _make_membership(client, other_tournament.id, u["id"]).status_code == 403


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def test_list_memberships(client, td_user, td_tournament, db):
    u1 = _make_user(db, "alice@example.com")
    u2 = _make_user(db, "bob@example.com")
    login(client, "td@test.com", "tdpass")
    _make_membership(client, td_tournament.id, u1["id"])
    _make_membership(client, td_tournament.id, u2["id"])
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/")
    assert response.status_code == 200
    assert len(response.json()) >= 2


def test_list_memberships_filter_by_status(client, td_user, td_tournament, db):
    u1 = _make_user(db, "alice@example.com")
    u2 = _make_user(db, "bob@example.com")
    login(client, "td@test.com", "tdpass")
    _make_membership(client, td_tournament.id, u1["id"], status="confirmed")
    _make_membership(client, td_tournament.id, u2["id"], status="interested")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/?status=confirmed")
    assert response.status_code == 200
    assert all(m["status"] == "confirmed" for m in response.json())


def test_list_memberships_requires_view_volunteers(
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
    assert client.get(
        f"/tournaments/{other_tournament.id}/memberships/"
    ).status_code == 403


# ---------------------------------------------------------------------------
# Get single
# ---------------------------------------------------------------------------

def test_get_membership(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    created = _make_membership(client, td_tournament.id, u["id"]).json()
    response = client.get(
        f"/tournaments/{td_tournament.id}/memberships/{created['id']}/"
    )
    assert response.status_code == 200
    assert response.json()["id"] == created["id"]


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_update_membership_status(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    created = _make_membership(client, td_tournament.id, u["id"]).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{created['id']}/",
        json={"status": "confirmed"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "confirmed"


def test_update_membership_positions(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    created = _make_membership(client, td_tournament.id, u["id"]).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{created['id']}/",
        json={"positions": ["lead_event_supervisor", "test_writer"]},
    )
    assert response.status_code == 200
    assert response.json()["positions"] == ["lead_event_supervisor", "test_writer"]


def test_update_membership_schedule(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    b1 = _make_block(client, td_tournament.id, label="Block 1", start="09:00", end="11:00")
    b2 = _make_block(client, td_tournament.id, label="Block 2", start="11:00", end="13:00")
    created = _make_membership(client, td_tournament.id, u["id"]).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{created['id']}/",
        json={"schedule": [
            {"time_block_id": b1["id"], "duty": "event_supervisor"},
            {"time_block_id": b2["id"], "duty": "scoring"},
        ]},
    )
    assert response.status_code == 200
    assert response.json()["schedule"][1]["duty"] == "scoring"
    assert response.json()["schedule"][1]["time_block_id"] == b2["id"]


def test_update_membership_extra_data_merges(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    created = _make_membership(
        client, td_tournament.id, u["id"],
        extra_data={"transportation": "Driving"},
    ).json()
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{created['id']}/",
        json={"extra_data": {"carpool_seats": 3}},
    )
    assert response.status_code == 200
    extra = response.json()["extra_data"]
    assert extra["transportation"] == "Driving"
    assert extra["carpool_seats"] == 3


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_membership(client, td_user, td_tournament, db):
    u = _make_user(db)
    login(client, "td@test.com", "tdpass")
    created = _make_membership(client, td_tournament.id, u["id"]).json()
    assert client.delete(
        f"/tournaments/{td_tournament.id}/memberships/{created['id']}/"
    ).status_code == 204


def test_delete_membership_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(
        f"/tournaments/{td_tournament.id}/memberships/9999/"
    ).status_code == 404