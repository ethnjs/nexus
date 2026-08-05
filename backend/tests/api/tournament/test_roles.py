"""Tests for TournamentRole CRUD and membership-role assignment
(app/api/routes/tournament/roles.py)."""
from tests.conftest import grant_role, login
from app.core.tournament.permissions import MANAGE_ROLES
from app.models.models import Tournament, TournamentMembership, TournamentMembershipRole, TournamentRole


def make_role(db, tournament: Tournament, key: str, rank: int, permissions=None, label=None) -> TournamentRole:
    """Create a custom-rank TournamentRole directly, for rank-bound test scenarios
    DEFAULT_ROLES doesn't cover (e.g. a MANAGE_ROLES holder who isn't the TD)."""
    role = TournamentRole(
        tournament_id=tournament.id,
        key=key,
        label=label or key,
        rank=rank,
        permissions=permissions or [],
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def get_role_id(db, tournament_id: int, key: str) -> int:
    return (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament_id, TournamentRole.key == key)
        .first()
        .id
    )


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/roles/ — any member can read
# ---------------------------------------------------------------------------

def test_list_roles_member_can_access(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/roles/")
    assert response.status_code == 200
    keys = [r["key"] for r in response.json()]
    assert "tournament_director" in keys


def test_list_roles_volunteer_member_can_access(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "event_supervisor")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/roles/").status_code == 200


def test_list_roles_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/roles/").status_code == 404


def test_list_roles_ordered_by_rank(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    ranks = [r["rank"] for r in client.get(f"/tournaments/{td_tournament.id}/roles/").json()]
    assert ranks == sorted(ranks)


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/roles/ — manage_tournament or manage_roles (rank-bound)
# ---------------------------------------------------------------------------

def test_create_role_td_can_create(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/roles/", json={
        "key": "photographer", "label": "Photographer", "permissions": [], "rank": 5,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["key"] == "photographer"
    assert data["rank"] == 5


def test_create_role_duplicate_key_conflict(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    payload = {"key": "photographer", "label": "Photographer", "permissions": [], "rank": 5}
    client.post(f"/tournaments/{td_tournament.id}/roles/", json=payload)
    response = client.post(f"/tournaments/{td_tournament.id}/roles/", json=payload)
    assert response.status_code == 409


def test_create_role_non_member_forbidden(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{other_tournament.id}/roles/", json={
        "key": "photographer", "label": "Photographer", "permissions": [], "rank": 5,
    })
    assert response.status_code == 404


def test_create_role_without_manage_roles_forbidden(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "event_supervisor")
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{other_tournament.id}/roles/", json={
        "key": "photographer", "label": "Photographer", "permissions": [], "rank": 5,
    })
    assert response.status_code == 403


def test_create_role_unauthenticated(client, td_tournament):
    response = client.post(f"/tournaments/{td_tournament.id}/roles/", json={
        "key": "photographer", "label": "Photographer", "permissions": [], "rank": 5,
    })
    assert response.status_code == 401


def test_create_role_manage_roles_holder_can_create_lower_rank(client, td_user, other_tournament, db):
    """A MANAGE_ROLES holder (rank 2, no MANAGE_TOURNAMENT) can create a role
    ranked below their own (higher number = lower authority)."""
    coordinator = make_role(db, other_tournament, "coordinator", rank=2, permissions=[MANAGE_ROLES])
    grant_role(db, other_tournament, td_user, "coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.post(f"/tournaments/{other_tournament.id}/roles/", json={
        "key": "photographer", "label": "Photographer", "permissions": [], "rank": 5,
    })
    assert response.status_code == 201


def test_create_role_manage_roles_holder_cannot_create_same_or_higher_rank(client, td_user, other_tournament, db):
    """Same MANAGE_ROLES holder cannot create a role at or above (numerically
    <=) their own rank — MANAGE_TOURNAMENT does not exempt this."""
    make_role(db, other_tournament, "coordinator", rank=2, permissions=[MANAGE_ROLES])
    grant_role(db, other_tournament, td_user, "coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.post(f"/tournaments/{other_tournament.id}/roles/", json={
        "key": "rival_coordinator", "label": "Rival Coordinator", "permissions": [], "rank": 2,
    })
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/roles/{role_id}/ — manage_tournament or manage_roles (rank-bound)
# ---------------------------------------------------------------------------

def test_update_role_td_can_update_label(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "event_supervisor")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/roles/{role_id}/", json={"label": "Floor Supervisor"}
    )
    assert response.status_code == 200
    assert response.json()["label"] == "Floor Supervisor"


def test_update_role_key_conflict(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "event_supervisor")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/roles/{role_id}/", json={"key": "tournament_director"}
    )
    assert response.status_code == 409


def test_update_role_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.patch(
        f"/tournaments/{td_tournament.id}/roles/9999/", json={"label": "Ghost"}
    ).status_code == 404


def test_update_role_manage_roles_holder_cannot_uprank_to_own_rank(client, td_user, other_tournament, db):
    make_role(db, other_tournament, "coordinator", rank=2, permissions=[MANAGE_ROLES])
    target = make_role(db, other_tournament, "photographer", rank=5)
    grant_role(db, other_tournament, td_user, "coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/roles/{target.id}/", json={"rank": 2}
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/roles/{role_id}/ — manage_tournament or manage_roles (rank-bound)
# ---------------------------------------------------------------------------

def test_delete_role_td_can_delete(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "test_reviewer")
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/roles/{role_id}/").status_code == 204
    assert db.query(TournamentRole).filter(TournamentRole.id == role_id).first() is None


def test_delete_role_cascades_membership_assignment(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "event_supervisor")
    role_id = get_role_id(db, td_tournament.id, "event_supervisor")
    assert db.query(TournamentMembershipRole).filter(
        TournamentMembershipRole.membership_id == membership.id,
        TournamentMembershipRole.role_id == role_id,
    ).first() is not None

    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/roles/{role_id}/").status_code == 204

    assert db.query(TournamentMembershipRole).filter(
        TournamentMembershipRole.role_id == role_id,
    ).first() is None


def test_delete_role_manage_roles_holder_cannot_delete_higher_rank(client, td_user, other_tournament, db):
    make_role(db, other_tournament, "coordinator", rank=2, permissions=[MANAGE_ROLES])
    higher = make_role(db, other_tournament, "director_deputy", rank=1)
    grant_role(db, other_tournament, td_user, "coordinator")
    login(client, "td@test.com", "tdpass")

    assert client.delete(f"/tournaments/{other_tournament.id}/roles/{higher.id}/").status_code == 403


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/memberships/{membership_id}/roles/
# Batch add/remove
# ---------------------------------------------------------------------------

def test_assign_roles_add_and_remove_in_one_call(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "event_supervisor")
    add_role_id = get_role_id(db, td_tournament.id, "test_writer")
    remove_role_id = get_role_id(db, td_tournament.id, "event_supervisor")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{membership.id}/roles/",
        json={"add": [add_role_id], "remove": [remove_role_id]},
    )
    assert response.status_code == 200
    role_keys = [r["key"] for r in response.json()["roles"]]
    assert "test_writer" in role_keys
    assert "event_supervisor" not in role_keys


def test_assign_roles_add_already_held_is_noop(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "event_supervisor")
    role_id = get_role_id(db, td_tournament.id, "event_supervisor")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{membership.id}/roles/",
        json={"add": [role_id]},
    )
    assert response.status_code == 200
    role_keys = [r["key"] for r in response.json()["roles"]]
    assert role_keys.count("event_supervisor") == 1


def test_assign_roles_remove_not_held_is_noop(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "event_supervisor")
    unheld_role_id = get_role_id(db, td_tournament.id, "test_writer")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{membership.id}/roles/",
        json={"remove": [unheld_role_id]},
    )
    assert response.status_code == 200
    role_keys = [r["key"] for r in response.json()["roles"]]
    assert "event_supervisor" in role_keys


def test_assign_roles_self_demotion_allowed(client, td_user, other_tournament, db):
    """A MANAGE_ROLES holder can remove their own higher role from themselves."""
    make_role(db, other_tournament, "coordinator", rank=2, permissions=[MANAGE_ROLES])
    membership = grant_role(db, other_tournament, td_user, "coordinator")
    role_id = get_role_id(db, other_tournament.id, "coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{membership.id}/roles/",
        json={"remove": [role_id]},
    )
    assert response.status_code == 200
    assert response.json()["roles"] == []


def test_assign_roles_self_promotion_blocked(client, td_user, other_tournament, db):
    """Assigning yourself a role above your own rank is blocked, even though
    self-modification is otherwise unrestricted."""
    make_role(db, other_tournament, "coordinator", rank=2, permissions=[MANAGE_ROLES])
    higher = make_role(db, other_tournament, "director_deputy", rank=1)
    membership = grant_role(db, other_tournament, td_user, "coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{membership.id}/roles/",
        json={"add": [higher.id]},
    )
    assert response.status_code == 403


def test_assign_roles_cannot_touch_role_that_outranks_actor(client, td_user, other_tournament, other_user, db):
    """Even acting on someone else's membership, you can't assign/remove a
    role that outranks your own."""
    make_role(db, other_tournament, "coordinator", rank=2, permissions=[MANAGE_ROLES])
    higher = make_role(db, other_tournament, "director_deputy", rank=1)
    grant_role(db, other_tournament, td_user, "coordinator")
    target_membership = grant_role(db, other_tournament, other_user, "event_supervisor")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{target_membership.id}/roles/",
        json={"add": [higher.id]},
    )
    assert response.status_code == 403


def test_assign_roles_cannot_modify_member_who_outranks_actor(client, td_user, other_tournament, other_user, db):
    """A member's roster of roles can't be touched at all by someone who
    doesn't outrank the member's current highest role, even for a low-rank
    role add."""
    make_role(db, other_tournament, "coordinator", rank=2, permissions=[MANAGE_ROLES])
    low_role = make_role(db, other_tournament, "photographer", rank=5)
    grant_role(db, other_tournament, td_user, "coordinator")
    # other_user is already tournament_director (rank 1) via other_tournament fixture
    login(client, "td@test.com", "tdpass")

    other_user_membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == other_tournament.id,
            TournamentMembership.user_id == other_user.id,
        )
        .first()
    )
    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{other_user_membership.id}/roles/",
        json={"add": [low_role.id]},
    )
    assert response.status_code == 403


def test_assign_roles_role_not_found(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "event_supervisor")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{membership.id}/roles/",
        json={"add": [9999]},
    )
    assert response.status_code == 404


def test_assign_roles_membership_not_found(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "event_supervisor")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/9999/roles/",
        json={"add": [role_id]},
    )
    assert response.status_code == 404


def test_assign_roles_non_member_forbidden(client, td_user, other_tournament, other_user, db):
    target_membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == other_tournament.id,
            TournamentMembership.user_id == other_user.id,
        )
        .first()
    )
    role_id = get_role_id(db, other_tournament.id, "event_supervisor")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{target_membership.id}/roles/",
        json={"add": [role_id]},
    )
    assert response.status_code == 404
