"""Tests for tournament join-code endpoints (app/api/routes/tournament/join_codes.py)."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from tests.conftest import grant_role, login
from app.models.models import TournamentJoinCode, TournamentMembership


def make_join_code(db, tournament_id, created_by, **kwargs):
    defaults = {
        "code": "JOIN1234",
        "label": "Join code",
        "expires_at": None,
        "is_active": True,
    }
    defaults.update(kwargs)
    join_code = TournamentJoinCode(
        tournament_id=tournament_id,
        created_by=created_by,
        **defaults,
    )
    db.add(join_code)
    db.commit()
    db.refresh(join_code)
    return join_code


# ---------------------------------------------------------------------------
# POST /tournaments/join/?code={code} — any authenticated user
# ---------------------------------------------------------------------------

def test_join_tournament_success_creates_interested_membership(client, td_user, td_tournament, other_user, db):
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="USECOUNT")
    login(client, "other@test.com", "otherpass")

    response = client.post("/tournaments/join/?code=USECOUNT")
    assert response.status_code == 201
    data = response.json()
    assert data["tournament_id"] == td_tournament.id

    membership = db.query(TournamentMembership).filter(
        TournamentMembership.user_id == other_user.id,
        TournamentMembership.tournament_id == td_tournament.id,
    ).first()
    assert membership is not None
    assert membership.status == "interested"
    assert membership.roles == []

    db.refresh(join_code)
    assert join_code.use_count == 1


def test_join_tournament_requires_authentication(client):
    assert client.post("/tournaments/join/?code=JOIN1234").status_code == 401


def test_join_tournament_rejects_missing_code(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.post("/tournaments/join/").status_code == 422


@pytest.mark.parametrize("code", ["SHORT", "TOO-LONG9", "UNKNOWN1"])
def test_join_tournament_rejects_code_that_does_not_exist(client, td_user, code):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/join/?code={code}")
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or expired join code"


def test_join_tournament_rejects_deactivated_code(client, td_user, td_tournament, other_user, db):
    make_join_code(db, td_tournament.id, td_user.id, code="INACTIVE", is_active=False)
    login(client, "other@test.com", "otherpass")

    response = client.post("/tournaments/join/?code=INACTIVE")
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or expired join code"


def test_join_tournament_rejects_expired_code(client, td_user, td_tournament, other_user, db):
    expired_at = datetime.now(timezone.utc) - timedelta(hours=1)
    make_join_code(db, td_tournament.id, td_user.id, code="EXPIRED1", expires_at=expired_at)
    login(client, "other@test.com", "otherpass")

    response = client.post("/tournaments/join/?code=EXPIRED1")
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid or expired join code"


def test_join_tournament_rejects_existing_member(client, td_user, td_tournament, other_user, db):
    grant_role(db, td_tournament, other_user, "event_supervisor")
    make_join_code(db, td_tournament.id, td_user.id, code="AGAIN123")
    login(client, "other@test.com", "otherpass")

    response = client.post("/tournaments/join/?code=AGAIN123")
    assert response.status_code == 409
    assert response.json()["detail"] == "Already a member of this tournament"


def test_join_tournament_handles_membership_integrity_conflict(client, td_user, td_tournament, other_user, db, monkeypatch):
    make_join_code(db, td_tournament.id, td_user.id, code="RACE1234")
    login(client, "other@test.com", "otherpass")

    def raise_integrity_error():
        raise IntegrityError("INSERT INTO tournament_memberships", {}, Exception("duplicate membership"))

    monkeypatch.setattr(db, "commit", raise_integrity_error)
    response = client.post("/tournaments/join/?code=RACE1234")
    assert response.status_code == 409
    assert response.json()["detail"] == "Already a member of this tournament"


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/join-codes/ — manage_tournament
# ---------------------------------------------------------------------------

def test_list_join_codes_td_can_access(client, td_user, td_tournament, db):
    make_join_code(db, td_tournament.id, td_user.id)
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/join-codes/")
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_list_join_codes_volunteer_forbidden(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "event_supervisor")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/join-codes/").status_code == 403


def test_list_join_codes_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/join-codes/").status_code == 404


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/join-codes/ — manage_tournament
# ---------------------------------------------------------------------------

def test_create_join_code_creates_record(client, td_user, td_tournament, db):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/join-codes/",
        json={"label": "Volunteer sign-up", "expires_in_hours": 24},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["label"] == "Volunteer sign-up"
    assert data["is_active"] is True
    assert data["code"]
    assert data["use_count"] == 0
    assert data["expires_at"] is not None

    created = db.query(TournamentJoinCode).filter_by(id=data["id"]).first()
    assert created is not None
    assert created.created_by == td_user.id


def test_create_join_code_never_expires_when_omitted(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/join-codes/", json={})
    assert response.status_code == 201
    assert response.json()["expires_at"] is None


def test_create_join_code_volunteer_forbidden(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "event_supervisor")
    login(client, "td@test.com", "tdpass")
    assert client.post(f"/tournaments/{other_tournament.id}/join-codes/", json={}).status_code == 403


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/join-codes/{code_id}/ — manage_tournament
# ---------------------------------------------------------------------------

def test_update_join_code_label_only(client, td_user, td_tournament, db):
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="LABELUP1")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/join-codes/{join_code.id}/", json={"label": "Updated Label"}
    )
    assert response.status_code == 200
    assert response.json()["label"] == "Updated Label"
    assert response.json()["expires_at"] is None


def test_update_join_code_add_hours_from_no_expiry(client, td_user, td_tournament, db):
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="ADDHRS01", expires_at=None)
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/join-codes/{join_code.id}/", json={"add_hours": 24}
    )
    assert response.status_code == 200
    assert response.json()["expires_at"] is not None


def test_update_join_code_add_hours_is_cumulative(client, td_user, td_tournament, db):
    base = datetime.now(timezone.utc) + timedelta(hours=1)
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="ADDHRS02", expires_at=base)
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/join-codes/{join_code.id}/", json={"add_hours": 24}
    )
    assert response.status_code == 200
    new_expires_at = datetime.fromisoformat(response.json()["expires_at"].replace("Z", "+00:00"))
    assert new_expires_at > base + timedelta(hours=23)


def test_update_join_code_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.patch(
        f"/tournaments/{td_tournament.id}/join-codes/9999/", json={"label": "Ghost"}
    ).status_code == 404


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/join-codes/{code_id}/ — manage_tournament
# ---------------------------------------------------------------------------

def test_deactivate_join_code_marks_inactive(client, td_user, td_tournament, db):
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="DEACT001")
    login(client, "td@test.com", "tdpass")

    assert client.delete(f"/tournaments/{td_tournament.id}/join-codes/{join_code.id}/").status_code == 204

    db.refresh(join_code)
    assert join_code.is_active is False


def test_deactivate_join_code_twice_rejected(client, td_user, td_tournament, db):
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="DEACT002", is_active=False)
    login(client, "td@test.com", "tdpass")

    assert client.delete(f"/tournaments/{td_tournament.id}/join-codes/{join_code.id}/").status_code == 400


def test_deactivate_join_code_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/join-codes/9999/").status_code == 404
