"""Tests for /tournaments/{tournament_id}/memberships endpoints."""
import pytest
from fastapi.testclient import TestClient
from app.core.tournament.permissions import MANAGE_MEMBERS
from app.models.models import TournamentMembership, TournamentMembershipRole, TournamentRole
from tests.conftest import grant_role, login


def get_role_id_by_label(db, tournament_id: int, label: str) -> int:
    return (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament_id, TournamentRole.label == label)
        .first()
        .id
    )


def _make_user(db, email="alice@example.com", first_name="Alice", last_name="Smith"):
    """Create a user directly in the DB — bypasses the admin-only POST /users/ route."""
    from app.models.models import User as UserModel
    user = UserModel(first_name=first_name, last_name=last_name, email=email)
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
    assert row["status"] == "interested"


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
# GET /tournaments/{tournament_id}/memberships/search/?q=&role_id=&exclude_role_id=
# manage_members. Registered before /{membership_id}/ so it must not be
# swallowed by that route.
# ---------------------------------------------------------------------------

def test_search_memberships_by_name(client, td_user, td_tournament, db):
    zed = _make_user(db, "zed@example.com", first_name="Zed", last_name="Zephyr")
    priya = _make_user(db, "priya@example.com", first_name="Priya", last_name="Patel")
    _make_membership(db, td_tournament.id, zed["id"])
    _make_membership(db, td_tournament.id, priya["id"])
    login(client, "td@test.com", "tdpass")

    response = client.get(f"/tournaments/{td_tournament.id}/memberships/search/?q=Priya")
    assert response.status_code == 200
    emails = [m["user"]["email"] for m in response.json()]
    assert emails == ["priya@example.com"]


def test_search_memberships_by_email(client, td_user, td_tournament, db):
    zed = _make_user(db, "zed@example.com", first_name="Zed", last_name="Zephyr")
    priya = _make_user(db, "priya@example.com", first_name="Priya", last_name="Patel")
    _make_membership(db, td_tournament.id, zed["id"])
    _make_membership(db, td_tournament.id, priya["id"])
    login(client, "td@test.com", "tdpass")

    response = client.get(f"/tournaments/{td_tournament.id}/memberships/search/?q=zed@example")
    assert response.status_code == 200
    emails = [m["user"]["email"] for m in response.json()]
    assert emails == ["zed@example.com"]


def test_search_memberships_by_role_id(client, td_user, td_tournament, db):
    from app.models.models import User as UserModel
    u = _make_user(db, "coach@example.com")
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    grant_role(db, td_tournament, user, "Volunteer")
    login(client, "td@test.com", "tdpass")

    role_id = get_role_id_by_label(db, td_tournament.id, "Volunteer")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/search/?role_id={role_id}")
    assert response.status_code == 200
    emails = [m["user"]["email"] for m in response.json()]
    assert emails == ["coach@example.com"]


def test_search_memberships_exclude_role_id(client, td_user, td_tournament, db):
    """td_user already holds Tournament Director from the fixture — excluding
    that role should drop them from the results."""
    role_id = get_role_id_by_label(db, td_tournament.id, "Tournament Director")
    login(client, "td@test.com", "tdpass")

    response = client.get(f"/tournaments/{td_tournament.id}/memberships/search/?exclude_role_id={role_id}")
    assert response.status_code == 200
    emails = [m["user"]["email"] for m in response.json()]
    assert "td@test.com" not in emails


def test_search_memberships_no_filters_returns_all(client, td_user, td_tournament, db):
    zed = _make_user(db, "zed@example.com")
    _make_membership(db, td_tournament.id, zed["id"])
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/search/")
    assert response.status_code == 200
    assert len(response.json()) >= 2


def test_search_memberships_requires_manage_members(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/memberships/search/"
    ).status_code == 403


def test_search_memberships_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/memberships/search/"
    ).status_code == 404


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
# GET /tournaments/{tournament_id}/memberships/me/ — any member
# ---------------------------------------------------------------------------

def test_get_my_membership_owner(client, td_user, td_tournament):
    """td_user is both the owner and holds Tournament Director — is_owner
    True and permissions come back as the full set regardless of role."""
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/me/")
    assert response.status_code == 200
    data = response.json()
    assert data["is_owner"] is True
    assert data["status"] == "confirmed"
    assert data["membership_id"] is not None
    assert [r["label"] for r in data["roles"]] == ["Tournament Director"]
    assert len(data["permissions"]) > 0


def test_get_my_membership_non_owner_with_role(client, td_tournament, db):
    """A plain member sees is_owner False and permissions scoped to their role."""
    from app.core.auth import hash_password
    from app.models.models import User as UserModel

    u = _make_user(db, "volunteer@example.com")
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    user.hashed_password = hash_password("volpass")
    db.commit()
    membership = grant_role(db, td_tournament, user, "Volunteer")

    login(client, "volunteer@example.com", "volpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/me/")
    assert response.status_code == 200
    data = response.json()
    assert data["is_owner"] is False
    assert data["membership_id"] == membership.id
    assert [r["label"] for r in data["roles"]] == ["Volunteer"]


def test_get_my_membership_admin_without_membership(client, admin_user, td_tournament):
    """A site admin who never joined the tournament still gets in via
    require_membership()'s admin bypass — membership_id/status/roles are
    null/empty but permissions come back as the full admin set."""
    login(client, "admin@test.com", "adminpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/me/")
    assert response.status_code == 200
    data = response.json()
    assert data["membership_id"] is None
    assert data["is_owner"] is False
    assert data["status"] is None
    assert data["roles"] == []
    assert len(data["permissions"]) > 0


def test_get_my_membership_requires_membership(client, td_user, other_tournament):
    """No membership at all in the tournament — 404, not 403, so existence
    isn't leaked."""
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/memberships/me/"
    ).status_code == 404


def test_get_my_membership_not_found_tournament(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/tournaments/9999/memberships/me/").status_code == 404


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


# ---------------------------------------------------------------------------
# Rank-bound target protection (validate_member_target) — regression coverage
# for a low-rank MANAGE_MEMBERS holder being able to remove/edit the
# tournament owner or a strictly-senior member. See validate_member_target
# in app/core/tournament/roles.py.
# ---------------------------------------------------------------------------

def _make_low_rank_role(db, tournament, label="Weak Staff", rank=90):
    """A MANAGE_MEMBERS-holding role ranked well below the fixture's default
    tiers (rank <= 40) — the actor here is authorized to touch member data
    but should still never be allowed to reach the owner or someone senior."""
    role = TournamentRole(tournament_id=tournament.id, label=label, rank=rank, permissions=[MANAGE_MEMBERS])
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def _owner_membership(db, tournament) -> TournamentMembership:
    return (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == tournament.id,
            TournamentMembership.user_id == tournament.owner_id,
        )
        .first()
    )


def test_delete_membership_owner_target_forbidden(client, td_user, other_tournament, db):
    """The bug this guards against: other_tournament's owner already holds
    the Tournament Director role (top rank) via the fixture, so a weak
    MANAGE_MEMBERS holder trying to delete them fails the ordinary rank
    comparison too — but this confirms it's actually blocked end to end."""
    owner_membership = _owner_membership(db, other_tournament)
    _make_low_rank_role(db, other_tournament, "Weak Staff", rank=90)
    grant_role(db, other_tournament, td_user, "Weak Staff")
    login(client, "td@test.com", "tdpass")

    response = client.delete(
        f"/tournaments/{other_tournament.id}/memberships/{owner_membership.id}/"
    )
    assert response.status_code == 403


def test_delete_membership_owner_target_forbidden_even_when_owner_has_no_role(client, td_user, other_tournament, db):
    """Rank is opt-in — an owner who holds no TournamentRole has no
    get_highest_rank result at all, so the plain rank comparison alone
    (`target_rank is not None and target_rank < actor_rank`) would silently
    pass and let them be deleted. validate_member_target's explicit
    owner check is what actually stops this."""
    owner_membership = _owner_membership(db, other_tournament)
    db.query(TournamentMembershipRole).filter(
        TournamentMembershipRole.membership_id == owner_membership.id
    ).delete()
    db.commit()

    _make_low_rank_role(db, other_tournament, "Weak Staff", rank=90)
    grant_role(db, other_tournament, td_user, "Weak Staff")
    login(client, "td@test.com", "tdpass")

    response = client.delete(
        f"/tournaments/{other_tournament.id}/memberships/{owner_membership.id}/"
    )
    assert response.status_code == 403
    assert db.query(TournamentMembership).filter(TournamentMembership.id == owner_membership.id).first() is not None


def test_delete_membership_target_outranks_actor_forbidden(client, td_user, other_tournament, db):
    """A non-owner target who's strictly senior to the actor is protected too."""
    senior_role = _make_low_rank_role(db, other_tournament, "Senior Staff", rank=5)
    u = _make_user(db)
    target_membership = _make_membership(db, other_tournament.id, u["id"])
    db.add(TournamentMembershipRole(membership_id=target_membership.id, role_id=senior_role.id))
    db.commit()

    _make_low_rank_role(db, other_tournament, "Weak Staff", rank=90)
    grant_role(db, other_tournament, td_user, "Weak Staff")
    login(client, "td@test.com", "tdpass")

    response = client.delete(
        f"/tournaments/{other_tournament.id}/memberships/{target_membership.id}/"
    )
    assert response.status_code == 403


def test_delete_membership_tied_rank_target_allowed(client, td_user, other_tournament, db):
    """Peers at the same rank can still act on each other — only strictly
    senior targets (or the owner) are protected."""
    peer_role = _make_low_rank_role(db, other_tournament, "Peer Staff", rank=40)
    u = _make_user(db)
    target_membership = _make_membership(db, other_tournament.id, u["id"])
    db.add(TournamentMembershipRole(membership_id=target_membership.id, role_id=peer_role.id))
    db.commit()

    grant_role(db, other_tournament, td_user, "Peer Staff")
    login(client, "td@test.com", "tdpass")

    response = client.delete(
        f"/tournaments/{other_tournament.id}/memberships/{target_membership.id}/"
    )
    assert response.status_code == 204


def test_update_membership_owner_target_forbidden_even_when_owner_has_no_role(client, td_user, other_tournament, db):
    """Same owner protection applies to the day-of-logistics PATCH, not just delete."""
    owner_membership = _owner_membership(db, other_tournament)
    db.query(TournamentMembershipRole).filter(
        TournamentMembershipRole.membership_id == owner_membership.id
    ).delete()
    db.commit()

    _make_low_rank_role(db, other_tournament, "Weak Staff", rank=90)
    grant_role(db, other_tournament, td_user, "Weak Staff")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{other_tournament.id}/memberships/{owner_membership.id}/",
        json={"notes": "should not be allowed"},
    )
    assert response.status_code == 403
