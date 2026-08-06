"""Tests for TournamentRole CRUD and membership-role assignment
(app/api/routes/tournament/roles.py)."""
from tests.conftest import grant_role, login
from app.core.tournament.audit import ROLE_CREATED, ROLE_UPDATED
from app.core.tournament.permissions import DEFAULT_ROLES, MANAGE_MEMBERS, MANAGE_ROLES
from app.models.models import (
    AuditLogEntry, Tournament, TournamentMembership, TournamentMembershipRole, TournamentRole, User,
)


def make_role(db, tournament: Tournament, label: str, rank: int, permissions=None) -> TournamentRole:
    """Create a custom-rank TournamentRole directly, for rank-bound test scenarios
    DEFAULT_ROLES doesn't cover (e.g. a MANAGE_ROLES holder who isn't the TD)."""
    role = TournamentRole(
        tournament_id=tournament.id,
        label=label,
        rank=rank,
        permissions=permissions or [],
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def make_plain_user(db, email: str) -> User:
    """A user with no tournament ties — unlike other_user, who is other_tournament's
    owner/TD by fixture, this one only ends up with whatever role a test grants it."""
    user = User(email=email, first_name="Plain", last_name="User", role="user", status="active")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_role_id(db, tournament_id: int, label: str) -> int:
    return (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament_id, TournamentRole.label == label)
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
    labels = [r["label"] for r in response.json()]
    assert "Tournament Director" in labels


def test_list_roles_volunteer_member_can_access(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
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
# POST /tournaments/{tournament_id}/roles/apply-template/ — manage_roles,
# empty-state only (409 once any role exists)
# ---------------------------------------------------------------------------

def _make_empty_tournament(client, name="Empty Tournament") -> int:
    """POST /tournaments/ itself no longer seeds roles — this is the real
    empty-state path apply-template is meant to be called against."""
    response = client.post("/tournaments/", json={"name": name, "location": "Test Location"})
    assert response.status_code == 201
    return response.json()["id"]


def test_apply_template_owner_can_apply_on_empty_tournament(client, td_user, db):
    login(client, "td@test.com", "tdpass")
    tournament_id = _make_empty_tournament(client)

    response = client.post(f"/tournaments/{tournament_id}/roles/apply-template/")
    assert response.status_code == 201
    data = response.json()
    assert len(data) == len(DEFAULT_ROLES)
    labels = {r["label"] for r in data}
    assert labels == {r["label"] for r in DEFAULT_ROLES}

    td_role = next(r for r in data if r["label"] == "Tournament Director")
    assert td_role["rank"] == 10
    assert "manage_tournament" in td_role["permissions"]

    volunteer_role = next(r for r in data if r["label"] == "Volunteer")
    assert volunteer_role["rank"] == 40
    assert volunteer_role["permissions"] == []


def test_apply_template_logs_role_created_per_row_no_template_action(client, td_user, db):
    login(client, "td@test.com", "tdpass")
    tournament_id = _make_empty_tournament(client)
    client.post(f"/tournaments/{tournament_id}/roles/apply-template/")

    entries = db.query(AuditLogEntry).filter(
        AuditLogEntry.tournament_id == tournament_id,
    ).all()
    assert len(entries) == len(DEFAULT_ROLES)
    assert all(e.action == ROLE_CREATED for e in entries)


def test_apply_template_conflict_when_roles_already_exist(client, td_user, td_tournament):
    """td_tournament already has DEFAULT_ROLES seeded via the test fixture."""
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/roles/apply-template/")
    assert response.status_code == 409


def test_apply_template_non_owner_without_manage_roles_forbidden(client, td_user, other_user, db):
    """A member with no role at all (nothing to grant MANAGE_ROLES from,
    since the tournament has zero roles) can't apply the template."""
    login(client, "other@test.com", "otherpass")
    tournament_id = _make_empty_tournament(client, name="Empty For Other")

    membership = TournamentMembership(
        user_id=td_user.id, tournament_id=tournament_id, status="confirmed", source="manual",
    )
    db.add(membership)
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{tournament_id}/roles/apply-template/")
    assert response.status_code == 403


def test_apply_template_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.post(f"/tournaments/{other_tournament.id}/roles/apply-template/").status_code == 404


def test_apply_template_unauthenticated(client, td_tournament):
    assert client.post(f"/tournaments/{td_tournament.id}/roles/apply-template/").status_code == 401


def test_apply_template_admin_bypasses(client, admin_user, td_user):
    login(client, "td@test.com", "tdpass")
    tournament_id = _make_empty_tournament(client, name="Empty For Admin")
    login(client, "admin@test.com", "adminpass")
    response = client.post(f"/tournaments/{tournament_id}/roles/apply-template/")
    assert response.status_code == 201


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/roles/ — manage_roles (rank-bound)
# ---------------------------------------------------------------------------

def test_create_role_td_can_create(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/roles/", json={
        "label": "Photographer", "permissions": [], "rank": 5,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["label"] == "Photographer"
    assert data["rank"] == 5


def test_create_role_duplicate_label_conflict(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    payload = {"label": "Photographer", "permissions": [], "rank": 5}
    client.post(f"/tournaments/{td_tournament.id}/roles/", json=payload)
    response = client.post(f"/tournaments/{td_tournament.id}/roles/", json=payload)
    assert response.status_code == 409


def test_create_role_non_member_forbidden(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{other_tournament.id}/roles/", json={
        "label": "Photographer", "permissions": [], "rank": 5,
    })
    assert response.status_code == 404


def test_create_role_without_manage_roles_forbidden(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{other_tournament.id}/roles/", json={
        "label": "Photographer", "permissions": [], "rank": 5,
    })
    assert response.status_code == 403


def test_create_role_unauthenticated(client, td_tournament):
    response = client.post(f"/tournaments/{td_tournament.id}/roles/", json={
        "label": "Photographer", "permissions": [], "rank": 5,
    })
    assert response.status_code == 401


def test_create_role_manage_roles_holder_can_create_lower_rank(client, td_user, other_tournament, db):
    """A MANAGE_ROLES holder (rank 2, no MANAGE_TOURNAMENT) can create a role
    ranked below their own (higher number = lower authority)."""
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES])
    grant_role(db, other_tournament, td_user, "Coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.post(f"/tournaments/{other_tournament.id}/roles/", json={
        "label": "Photographer", "permissions": [], "rank": 5,
    })
    assert response.status_code == 201


def test_create_role_manage_roles_holder_cannot_create_same_or_higher_rank(client, td_user, other_tournament, db):
    """Same MANAGE_ROLES holder cannot create a role at or above (numerically
    <=) their own rank — MANAGE_TOURNAMENT does not exempt this."""
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES])
    grant_role(db, other_tournament, td_user, "Coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.post(f"/tournaments/{other_tournament.id}/roles/", json={
        "label": "Rival Coordinator", "permissions": [], "rank": 2,
    })
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/roles/{role_id}/ — manage_roles (rank-bound)
# ---------------------------------------------------------------------------

def test_update_role_td_can_update_label(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/roles/{role_id}/", json={"label": "Floor Supervisor"}
    )
    assert response.status_code == 200
    assert response.json()["label"] == "Floor Supervisor"


def test_update_role_label_conflict(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/roles/{role_id}/", json={"label": "Tournament Director"}
    )
    assert response.status_code == 409


def test_update_role_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.patch(
        f"/tournaments/{td_tournament.id}/roles/9999/", json={"label": "Ghost"}
    ).status_code == 404


def test_update_role_manage_roles_holder_cannot_uprank_to_own_rank(client, td_user, other_tournament, db):
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES])
    target = make_role(db, other_tournament, "Photographer", rank=5)
    grant_role(db, other_tournament, td_user, "Coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/roles/{target.id}/", json={"rank": 2}
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/roles/{role_id}/reorder/ — manage_roles (rank-bound)
# td_tournament's DEFAULT_ROLES ranks: 10 (TD), 20 (six coordinator/runner/
# scoremaster roles), 30 (Lead Event Supervisor), 40 (six bottom-tier roles).
# ---------------------------------------------------------------------------

def test_reorder_join_group(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "Volunteer")  # currently rank 40
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/roles/{role_id}/reorder/",
        json={"drop_type": "join_group", "target_group_rank": 20},
    )
    assert response.status_code == 200
    assert response.json()["rank"] == 20


def test_reorder_new_rank_between(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "Volunteer")  # currently rank 40
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/roles/{role_id}/reorder/",
        json={"drop_type": "new_rank_between", "rank_above": 20, "rank_below": 30},
    )
    assert response.status_code == 200
    assert response.json()["rank"] == 25


def test_reorder_new_rank_at_top(client, td_user, td_tournament, db):
    """rank_below=20 (the second tier) gives 20-RANK_GAP=10 — which happens
    to tie with the real TD role, a valid outcome (ties are allowed)."""
    role_id = get_role_id(db, td_tournament.id, "Volunteer")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/roles/{role_id}/reorder/",
        json={"drop_type": "new_rank_at_top", "rank_below": 20},
    )
    assert response.status_code == 200
    assert response.json()["rank"] == 10


def test_reorder_new_rank_at_bottom(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "Tournament Director")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/roles/{role_id}/reorder/",
        json={"drop_type": "new_rank_at_bottom", "rank_above": 40},
    )
    assert response.status_code == 200
    assert response.json()["rank"] == 50


def test_reorder_logs_role_updated_with_rank_change(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "Volunteer")
    login(client, "td@test.com", "tdpass")
    client.patch(
        f"/tournaments/{td_tournament.id}/roles/{role_id}/reorder/",
        json={"drop_type": "join_group", "target_group_rank": 20},
    )

    entry = (
        db.query(AuditLogEntry)
        .filter(AuditLogEntry.tournament_id == td_tournament.id, AuditLogEntry.target_id == role_id)
        .order_by(AuditLogEntry.id.desc())
        .first()
    )
    assert entry.action == ROLE_UPDATED
    assert entry.extra_data == {"changes": [{"field": "rank", "old": 40, "new": 20}]}


def test_reorder_no_room_triggers_rebalance(client, td_user, td_tournament, db):
    """Two custom roles one rank apart leave no integer midpoint — the route
    rebalances the whole tournament to 10/20/30... first, translates the
    request's neighbor values through the remap, and retries once."""
    make_role(db, td_tournament, "Tight A", rank=5)
    make_role(db, td_tournament, "Tight B", rank=6)
    mover = make_role(db, td_tournament, "Mover", rank=999)
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/roles/{mover.id}/reorder/",
        json={"drop_type": "new_rank_between", "rank_above": 5, "rank_below": 6},
    )
    assert response.status_code == 200
    # distinct old ranks {5,6,10,20,30,40,999} -> remap to 10,20,30,40,50,60,70
    # in order, so 5->10, 6->20; retried midpoint is (10+20)//2 = 15.
    assert response.json()["rank"] == 15

    db.refresh(mover)
    td_role = db.query(TournamentRole).filter(
        TournamentRole.tournament_id == td_tournament.id, TournamentRole.label == "Tournament Director",
    ).first()
    assert td_role.rank == 30


def test_reorder_manage_roles_holder_cannot_move_role_to_own_rank(client, td_user, other_tournament, db):
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES])
    target = make_role(db, other_tournament, "Photographer", rank=5)
    grant_role(db, other_tournament, td_user, "Coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/roles/{target.id}/reorder/",
        json={"drop_type": "new_rank_between", "rank_above": 1, "rank_below": 2},
    )
    assert response.status_code == 403


def test_reorder_manage_roles_holder_cannot_move_role_that_outranks_them(client, td_user, other_tournament, db):
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES])
    higher = make_role(db, other_tournament, "Director Deputy", rank=1)
    grant_role(db, other_tournament, td_user, "Coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/roles/{higher.id}/reorder/",
        json={"drop_type": "new_rank_at_bottom", "rank_above": 5},
    )
    assert response.status_code == 403


def test_reorder_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/roles/9999/reorder/",
        json={"drop_type": "join_group", "target_group_rank": 20},
    )
    assert response.status_code == 404


def test_reorder_missing_required_field_for_drop_type_422(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/roles/{role_id}/reorder/",
        json={"drop_type": "new_rank_between", "rank_above": 20},
    )
    assert response.status_code == 422


def test_reorder_unauthenticated(client, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "Volunteer")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/roles/{role_id}/reorder/",
        json={"drop_type": "join_group", "target_group_rank": 20},
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/roles/{role_id}/ — manage_roles (rank-bound)
# ---------------------------------------------------------------------------

def test_delete_role_td_can_delete(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "Test Reviewer")
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/roles/{role_id}/").status_code == 204
    assert db.query(TournamentRole).filter(TournamentRole.id == role_id).first() is None


def test_delete_role_cascades_membership_assignment(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    role_id = get_role_id(db, td_tournament.id, "Volunteer")
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
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES])
    higher = make_role(db, other_tournament, "Director Deputy", rank=1)
    grant_role(db, other_tournament, td_user, "Coordinator")
    login(client, "td@test.com", "tdpass")

    assert client.delete(f"/tournaments/{other_tournament.id}/roles/{higher.id}/").status_code == 403


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/memberships/{membership_id}/roles/
# Batch add/remove
# ---------------------------------------------------------------------------

def test_assign_roles_add_and_remove_in_one_call(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    add_role_id = get_role_id(db, td_tournament.id, "Test Writer")
    remove_role_id = get_role_id(db, td_tournament.id, "Volunteer")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{membership.id}/roles/",
        json={"add": [add_role_id], "remove": [remove_role_id]},
    )
    assert response.status_code == 200
    role_labels = [r["label"] for r in response.json()["roles"]]
    assert "Test Writer" in role_labels
    assert "Volunteer" not in role_labels


def test_assign_roles_add_already_held_is_noop(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    role_id = get_role_id(db, td_tournament.id, "Volunteer")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{membership.id}/roles/",
        json={"add": [role_id]},
    )
    assert response.status_code == 200
    role_labels = [r["label"] for r in response.json()["roles"]]
    assert role_labels.count("Volunteer") == 1


def test_assign_roles_remove_not_held_is_noop(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    unheld_role_id = get_role_id(db, td_tournament.id, "Test Writer")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{membership.id}/roles/",
        json={"remove": [unheld_role_id]},
    )
    assert response.status_code == 200
    role_labels = [r["label"] for r in response.json()["roles"]]
    assert "Volunteer" in role_labels


def test_assign_roles_self_demotion_allowed(client, td_user, other_tournament, db):
    """A MANAGE_ROLES holder can remove their own higher role from themselves."""
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES, MANAGE_MEMBERS])
    membership = grant_role(db, other_tournament, td_user, "Coordinator")
    role_id = get_role_id(db, other_tournament.id, "Coordinator")
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
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES, MANAGE_MEMBERS])
    higher = make_role(db, other_tournament, "Director Deputy", rank=1)
    membership = grant_role(db, other_tournament, td_user, "Coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{membership.id}/roles/",
        json={"add": [higher.id]},
    )
    assert response.status_code == 403


def test_assign_roles_cannot_touch_role_that_outranks_actor(client, td_user, other_tournament, other_user, db):
    """Even acting on someone else's membership, you can't assign/remove a
    role that outranks your own."""
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES, MANAGE_MEMBERS])
    higher = make_role(db, other_tournament, "Director Deputy", rank=1)
    grant_role(db, other_tournament, td_user, "Coordinator")
    target_membership = grant_role(db, other_tournament, other_user, "Volunteer")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{target_membership.id}/roles/",
        json={"add": [higher.id]},
    )
    assert response.status_code == 403


def test_assign_roles_cannot_modify_member_who_outranks_actor(client, td_user, other_tournament, other_user, db):
    """A member's roster of roles can't be touched at all by someone who
    doesn't outrank the member's current highest role, even for a low-rank
    role add.

    Ranks here (20/50) are deliberately above the real Tournament Director's
    rank (10, from DEFAULT_ROLES) rather than the 1/2/5 used elsewhere in this
    file — this test compares against other_user's actual TD role, so
    Coordinator must sit below it in authority, not just below the other
    custom test-only roles."""
    make_role(db, other_tournament, "Coordinator", rank=20, permissions=[MANAGE_ROLES, MANAGE_MEMBERS])
    low_role = make_role(db, other_tournament, "Photographer", rank=50)
    grant_role(db, other_tournament, td_user, "Coordinator")
    # other_user is already tournament_director (rank 10) via other_tournament fixture
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
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{membership.id}/roles/",
        json={"add": [9999]},
    )
    assert response.status_code == 404


def test_assign_roles_membership_not_found(client, td_user, td_tournament, db):
    role_id = get_role_id(db, td_tournament.id, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/9999/roles/",
        json={"add": [role_id]},
    )
    assert response.status_code == 404


def test_assign_roles_same_rank_as_actor_allowed(client, td_user, other_tournament, db):
    """Assignment allows ties (role.rank == actor's own rank) — unlike role
    create/update, which blocks ties via _validate_rank_bound's `<=`. Here
    the check is strict `<`, so acting at your own rank is fine.

    Target must be a plain user (not other_user, who is other_tournament's
    owner/TD by fixture and would trip the target-outranks-actor check)."""
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES, MANAGE_MEMBERS])
    sibling = make_role(db, other_tournament, "Sibling Coordinator", rank=2)
    grant_role(db, other_tournament, td_user, "Coordinator")
    plain = make_plain_user(db, "plain1@example.com")
    target_membership = grant_role(db, other_tournament, plain, "Volunteer")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{target_membership.id}/roles/",
        json={"add": [sibling.id]},
    )
    assert response.status_code == 200
    assert "Sibling Coordinator" in [r["label"] for r in response.json()["roles"]]


def test_assign_roles_one_rank_above_actor_forbidden(client, td_user, other_tournament, db):
    """Boundary right past the tie case above — a role ranked exactly one
    above the actor's own (numerically lower = higher authority) is blocked."""
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES, MANAGE_MEMBERS])
    senior = make_role(db, other_tournament, "Senior Coordinator", rank=1)
    grant_role(db, other_tournament, td_user, "Coordinator")
    plain = make_plain_user(db, "plain1b@example.com")
    target_membership = grant_role(db, other_tournament, plain, "Volunteer")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{target_membership.id}/roles/",
        json={"add": [senior.id]},
    )
    assert response.status_code == 403


def test_assign_roles_target_with_same_rank_as_actor_allowed(client, td_user, other_tournament, db):
    """The target-member check is also strict `<` — modifying someone whose
    highest role ties your own rank is allowed, only strictly-higher-ranked
    targets are protected."""
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES, MANAGE_MEMBERS])
    low_role = make_role(db, other_tournament, "Photographer", rank=5)
    grant_role(db, other_tournament, td_user, "Coordinator")
    plain = make_plain_user(db, "plain2@example.com")
    target_membership = grant_role(db, other_tournament, plain, "Coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{target_membership.id}/roles/",
        json={"add": [low_role.id]},
    )
    assert response.status_code == 200
    assert "Photographer" in [r["label"] for r in response.json()["roles"]]


def test_assign_roles_target_one_rank_above_actor_forbidden(client, td_user, other_tournament, db):
    """Boundary right past the target-tie case above — a target whose highest
    role is exactly one rank above the actor's own is protected."""
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES, MANAGE_MEMBERS])
    make_role(db, other_tournament, "Senior Coordinator", rank=1)
    low_role = make_role(db, other_tournament, "Photographer", rank=5)
    grant_role(db, other_tournament, td_user, "Coordinator")
    plain = make_plain_user(db, "plain2b@example.com")
    target_membership = grant_role(db, other_tournament, plain, "Senior Coordinator")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{target_membership.id}/roles/",
        json={"add": [low_role.id]},
    )
    assert response.status_code == 403


def test_assign_roles_owner_bypasses_rank_check(client, td_user, td_tournament, other_user, db):
    """Tournament owner bypasses the rank check entirely — even with zero
    roles of their own (so no actor_rank), they can still assign top-rank
    roles to anyone."""
    db.query(TournamentMembershipRole).filter(
        TournamentMembershipRole.membership_id.in_(
            db.query(TournamentMembership.id).filter(
                TournamentMembership.tournament_id == td_tournament.id,
                TournamentMembership.user_id == td_user.id,
            )
        )
    ).delete(synchronize_session=False)
    db.commit()

    target_membership = grant_role(db, td_tournament, other_user, "Volunteer")
    td_role_id = get_role_id(db, td_tournament.id, "Tournament Director")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{target_membership.id}/roles/",
        json={"add": [td_role_id]},
    )
    assert response.status_code == 200
    assert "Tournament Director" in [r["label"] for r in response.json()["roles"]]


def test_assign_roles_non_owner_with_stripped_roles_forbidden(client, td_user, td_tournament, other_user, db):
    """Contrast with the owner-bypass case above: strip td_user's roles the
    same way, but on a tournament they don't own (other_tournament) — without
    the owner clause, holding zero roles means holding no MANAGE_ROLES
    permission at all, so the request is rejected outright."""
    make_role(db, td_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES, MANAGE_MEMBERS])
    membership = grant_role(db, td_tournament, other_user, "Coordinator")
    db.query(TournamentMembershipRole).filter(
        TournamentMembershipRole.membership_id == membership.id,
    ).delete(synchronize_session=False)
    db.commit()

    target_membership = grant_role(db, td_tournament, td_user, "Volunteer")
    td_role_id = get_role_id(db, td_tournament.id, "Tournament Director")
    login(client, "other@test.com", "otherpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{target_membership.id}/roles/",
        json={"add": [td_role_id]},
    )
    assert response.status_code == 403


def test_assign_roles_admin_bypasses_rank_check(client, admin_user, other_tournament, db):
    """Platform admin bypasses the rank check even without any membership in the tournament."""
    make_role(db, other_tournament, "Coordinator", rank=2, permissions=[MANAGE_ROLES, MANAGE_MEMBERS])
    plain = make_plain_user(db, "plain3@example.com")
    target_membership = grant_role(db, other_tournament, plain, "Coordinator")
    coordinator_role_id = get_role_id(db, other_tournament.id, "Coordinator")
    login(client, "admin@test.com", "adminpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{target_membership.id}/roles/",
        json={"remove": [coordinator_role_id]},
    )
    assert response.status_code == 200
    assert response.json()["roles"] == []


def test_assign_roles_non_member_forbidden(client, td_user, other_tournament, other_user, db):
    target_membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == other_tournament.id,
            TournamentMembership.user_id == other_user.id,
        )
        .first()
    )
    role_id = get_role_id(db, other_tournament.id, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{target_membership.id}/roles/",
        json={"add": [role_id]},
    )
    assert response.status_code == 404
