"""Tests for /tournaments/{tournament_id}/memberships endpoints."""
import pytest
from fastapi.testclient import TestClient
from app.models.models import TournamentMembership
from tests.conftest import grant_role, login


def _make_user(db, email="alice@example.com"):
    """Create a user directly in the DB — bypasses the admin-only POST /users/ route."""
    from app.models.models import User as UserModel
    user = UserModel(first_name="Alice", last_name="Smith", email=email)
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "email": user.email}


def _make_event(client, tournament_id):
    return client.post(f"/tournaments/{tournament_id}/events/", json={
        "tournament_id": tournament_id,
        "name": "Boomilever",
        "division": "C",
        "blocks": [1, 2, 3, 4, 5, 6],
    }).json()


def _make_membership(db, tournament_id, user_id, **overrides):
    """Create a membership directly in the DB — memberships are created via
    join codes or sync now, there's no manual-create route anymore."""
    defaults = {"user_id": user_id, "tournament_id": tournament_id, "status": "interested", "source": "manual"}
    defaults.update(overrides)
    membership = TournamentMembership(**defaults)
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return membership


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def test_list_memberships(client, td_user, td_tournament, db):
    u1 = _make_user(db, "alice@example.com")
    u2 = _make_user(db, "bob@example.com")
    _make_membership(db, td_tournament.id, u1["id"])
    _make_membership(db, td_tournament.id, u2["id"])
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/")
    assert response.status_code == 200
    # td_user's own membership (from tournament creation) + the two above
    assert len(response.json()) >= 2


def test_list_memberships_slim_shape(client, td_user, td_tournament, db):
    """Roster view — slim user identity + roles, no onboarding/logistics fields."""
    u = _make_user(db, "alice@example.com")
    _make_membership(db, td_tournament.id, u["id"], notes="Allergic to nuts")
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/")
    assert response.status_code == 200
    row = next(m for m in response.json() if m["user"]["id"] == u["id"])
    assert row["user"]["email"] == u["email"]
    assert row["roles"] == []
    assert "notes" not in row
    assert "status" not in row


def test_list_memberships_requires_manage_members(
    client, td_user, other_tournament, db
):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/memberships/"
    ).status_code == 403


def test_list_memberships_no_membership_in_tournament(client, td_user):
    """Membership existence check fires before permission — 404, not 403, so
    a tournament the user isn't in never leaks its existence."""
    login(client, "td@test.com", "tdpass")
    assert client.get("/tournaments/9999/memberships/").status_code == 404


def test_list_memberships_includes_roles(client, td_user, td_tournament, db):
    """Roles are unwrapped from TournamentMembershipRole to RoleRead in the slim response too."""
    from app.models.models import User as UserModel
    u = _make_user(db, "coach@example.com")
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    membership = grant_role(db, td_tournament, user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/")
    assert response.status_code == 200
    row = next(m for m in response.json() if m["id"] == membership.id)
    assert [r["label"] for r in row["roles"]] == ["Volunteer"]


# ---------------------------------------------------------------------------
# Get single
# ---------------------------------------------------------------------------

def test_get_membership(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"], notes="Allergic to nuts")
    login(client, "td@test.com", "tdpass")
    response = client.get(
        f"/tournaments/{td_tournament.id}/memberships/{m.id}/"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == m.id
    assert data["notes"] == "Allergic to nuts"
    assert data["status"] == "interested"
    assert data["user"]["email"] == u["email"]


def test_get_membership_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{td_tournament.id}/memberships/9999/"
    ).status_code == 404


def test_get_membership_wrong_tournament(client, td_user, td_tournament, other_tournament, db):
    """A real membership ID from a different tournament still 404s — no cross-tournament leak."""
    u = _make_user(db)
    m = _make_membership(db, other_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{td_tournament.id}/memberships/{m.id}/"
    ).status_code == 404


def test_get_membership_requires_manage_members(client, td_user, other_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, other_tournament.id, u["id"])
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/memberships/{m.id}/"
    ).status_code == 403


def test_get_membership_includes_roles(client, td_user, td_tournament, db):
    from app.models.models import User as UserModel
    u = _make_user(db, "coach2@example.com")
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    membership = grant_role(db, td_tournament, user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/{membership.id}/")
    assert response.status_code == 200
    assert [r["label"] for r in response.json()["roles"]] == ["Volunteer"]


# ---------------------------------------------------------------------------
# Self-service update — PATCH .../me/
# ---------------------------------------------------------------------------

def test_update_my_membership(client, td_tournament, db):
    u = _make_user(db, "volunteer@example.com")
    from app.core.auth import hash_password
    from app.models.models import User as UserModel
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    user.hashed_password = hash_password("volpass")
    db.commit()
    _make_membership(db, td_tournament.id, u["id"])

    login(client, "volunteer@example.com", "volpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/me/",
        json={"lunch_order": "Veggie Wrap", "role_preference": ["event_volunteer"]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["lunch_order"] == "Veggie Wrap"
    assert data["role_preference"] == ["event_volunteer"]


def test_update_my_membership_ignores_restricted_fields(client, td_tournament, db):
    """schedule/notes aren't in MembershipMeUpdate — sending them is a no-op, not an error."""
    u = _make_user(db, "volunteer2@example.com")
    from app.core.auth import hash_password
    from app.models.models import User as UserModel
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    user.hashed_password = hash_password("volpass")
    db.commit()
    _make_membership(db, td_tournament.id, u["id"])

    login(client, "volunteer2@example.com", "volpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/me/",
        json={"notes": "should not be saved", "status": "confirmed"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["notes"] is None
    assert data["status"] == "interested"


def test_update_my_membership_not_found(client, td_tournament, td_user):
    """td_user has no membership in a tournament they didn't join — 404, not 403."""
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id + 9999}/memberships/me/",
        json={"lunch_order": "Veggie Wrap"},
    )
    assert response.status_code == 404


def test_update_my_membership_only_affects_own_membership(client, td_tournament, db):
    """Two volunteers in the same tournament — one's self-update can't touch the other's row."""
    from app.core.auth import hash_password
    from app.models.models import User as UserModel

    u1 = _make_user(db, "vol-a@example.com")
    u2 = _make_user(db, "vol-b@example.com")
    for u, pw in [(u1, "volpassA"), (u2, "volpassB")]:
        user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
        user.hashed_password = hash_password(pw)
    db.commit()
    m1 = _make_membership(db, td_tournament.id, u1["id"], lunch_order="A's order")
    m2 = _make_membership(db, td_tournament.id, u2["id"], lunch_order="B's order")

    login(client, "vol-a@example.com", "volpassA")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/me/",
        json={"lunch_order": "Changed by A"},
    )
    assert response.status_code == 200
    assert response.json()["id"] == m1.id

    db.refresh(m2)
    assert m2.lunch_order == "B's order"


def test_update_my_membership_invalid_availability_shape(client, td_tournament, db):
    u = _make_user(db, "volunteer3@example.com")
    from app.core.auth import hash_password
    from app.models.models import User as UserModel
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    user.hashed_password = hash_password("volpass")
    db.commit()
    _make_membership(db, td_tournament.id, u["id"])

    login(client, "volunteer3@example.com", "volpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/me/",
        json={"availability": [{"date": "2026-05-21"}]},  # missing start/end
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Coordinator update — PATCH .../{membership_id}/
# ---------------------------------------------------------------------------

def test_update_membership_schedule(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{m.id}/",
        json={"schedule": [
            {"block": 1, "duty": "event_supervisor"},
            {"block": 7, "duty": "scoring"},
        ]},
    )
    assert response.status_code == 200
    assert response.json()["schedule"][1]["duty"] == "scoring"


def test_update_membership_notes(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{m.id}/",
        json={"notes": "Needs early lunch"},
    )
    assert response.status_code == 200
    assert response.json()["notes"] == "Needs early lunch"


def test_update_membership_ignores_onboarding_fields(client, td_user, td_tournament, db):
    """lunch_order/role_preference/etc aren't in MembershipCoordinatorUpdate."""
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"], lunch_order="Veggie Wrap")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{m.id}/",
        json={"lunch_order": "Changed by staff"},
    )
    assert response.status_code == 200
    assert response.json()["lunch_order"] == "Veggie Wrap"


def test_update_membership_requires_manage_members(client, td_user, other_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, other_tournament.id, u["id"])
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{m.id}/",
        json={"notes": "no permission"},
    )
    assert response.status_code == 403


def test_update_membership_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/9999/",
        json={"notes": "no such membership"},
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_membership(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    assert client.delete(
        f"/tournaments/{td_tournament.id}/memberships/{m.id}/"
    ).status_code == 204


def test_delete_membership_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(
        f"/tournaments/{td_tournament.id}/memberships/9999/"
    ).status_code == 404


def test_delete_membership_requires_manage_members(client, td_user, other_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, other_tournament.id, u["id"])
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.delete(
        f"/tournaments/{other_tournament.id}/memberships/{m.id}/"
    )
    assert response.status_code == 403
