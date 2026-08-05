"""Tests for /tournaments/ core CRUD endpoints (app/api/routes/tournament/__init__.py)."""
from tests.conftest import grant_role, login
from app.models.models import TournamentMembership, TournamentMembershipRole, TournamentRole


# ---------------------------------------------------------------------------
# GET /tournaments/me/ — user's own tournaments
# ---------------------------------------------------------------------------

def test_list_my_tournaments_returns_own(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.get("/tournaments/me/")
    assert response.status_code == 200
    assert td_tournament.id in [t["id"] for t in response.json()]


def test_list_my_tournaments_excludes_others(
    client, td_user, td_tournament, other_user, other_tournament
):
    login(client, "td@test.com", "tdpass")
    ids = [t["id"] for t in client.get("/tournaments/me/").json()]
    assert td_tournament.id in ids
    assert other_tournament.id not in ids


def test_list_my_tournaments_includes_volunteer_membership(
    client, td_user, other_tournament, db
):
    grant_role(db, other_tournament, td_user, "event_supervisor")
    login(client, "td@test.com", "tdpass")
    ids = [t["id"] for t in client.get("/tournaments/me/").json()]
    assert other_tournament.id in ids


def test_list_my_tournaments_admin_without_membership_sees_none(
    client, admin_user, td_tournament, other_tournament
):
    """/me reflects membership only now — admins aren't special-cased here.
    Admin has no membership in either tournament, so the list is empty; they'd
    use GET /admin/tournaments/ for the unrestricted view."""
    login(client, "admin@test.com", "adminpass")
    ids = [t["id"] for t in client.get("/tournaments/me/").json()]
    assert td_tournament.id not in ids
    assert other_tournament.id not in ids


def test_list_my_tournaments_unauthenticated(client):
    assert client.get("/tournaments/me/").status_code == 401


# ---------------------------------------------------------------------------
# POST /tournaments/ — any authenticated user
# ---------------------------------------------------------------------------

def test_create_tournament_minimal(client, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={"name": "Minimal Tournament", "location": "Test Location"})
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Minimal Tournament"
    assert data["is_public"] is False
    assert data["is_verified"] is False


def test_create_tournament_auto_populates_default_roles(client, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={"name": "Auto Roles", "location": "Test Location"})
    assert response.status_code == 201
    keys = [r["key"] for r in response.json()["roles"]]
    assert "tournament_director" in keys
    assert "event_supervisor" in keys


def test_create_tournament_auto_creates_td_membership(client, td_user, db):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={"name": "Auto TournamentMembership", "location": "Test Location"})
    assert response.status_code == 201
    tournament_id = response.json()["id"]
    membership = db.query(TournamentMembership).filter(
        TournamentMembership.user_id == td_user.id,
        TournamentMembership.tournament_id == tournament_id,
    ).first()
    assert membership is not None
    role_keys = [
        role.key for role in
        db.query(TournamentRole)
        .join(TournamentMembershipRole, TournamentMembershipRole.role_id == TournamentRole.id)
        .filter(TournamentMembershipRole.membership_id == membership.id)
        .all()
    ]
    assert "tournament_director" in role_keys


def test_create_tournament_full(client, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={
        "name": "Nationals 2025",
        "start_date": "2025-05-21T08:00:00",
        "end_date": "2025-05-23T18:00:00",
        "location": "USC",
        "is_public": True,
        "registration_opens_at": "2025-01-01T00:00:00",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Nationals 2025"
    assert data["is_public"] is True
    assert data["registration_opens_at"] is not None


def test_create_tournament_invalid_dates(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.post("/tournaments/", json={
        "name": "Bad Dates",
        "start_date": "2025-11-15T08:00:00",
        "end_date": "2025-11-14T08:00:00",
        "location": "Test Location",
    }).status_code == 422


def test_create_tournament_unauthenticated(client):
    assert client.post("/tournaments/", json={"name": "Sneaky", "location": "Nowhere"}).status_code == 401


# ---------------------------------------------------------------------------
# GET /tournaments/{id}/ — any member
# ---------------------------------------------------------------------------

def test_get_tournament_member_can_access(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/")
    assert response.status_code == 200
    assert response.json()["name"] == td_tournament.name


def test_get_tournament_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/").status_code == 404


def test_get_tournament_admin_can_access_any(client, admin_user, td_tournament):
    login(client, "admin@test.com", "adminpass")
    assert client.get(f"/tournaments/{td_tournament.id}/").status_code == 200


def test_get_tournament_volunteer_member_can_access(
    client, td_user, other_tournament, db
):
    grant_role(db, other_tournament, td_user, "event_supervisor")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/").status_code == 200


def test_get_tournament_not_found(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/tournaments/9999/").status_code == 404


# ---------------------------------------------------------------------------
# PATCH /tournaments/{id}/ — manage_tournament only
# ---------------------------------------------------------------------------

def test_update_tournament_td_can_patch(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.patch(f"/tournaments/{td_tournament.id}/", json={"name": "New Name"})
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"


def test_update_tournament_volunteer_member_cannot_patch(
    client, td_user, other_tournament, db
):
    grant_role(db, other_tournament, td_user, "event_supervisor")
    login(client, "td@test.com", "tdpass")
    assert client.patch(
        f"/tournaments/{other_tournament.id}/", json={"name": "Sneaky"}
    ).status_code == 403


def test_update_tournament_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.patch(
        f"/tournaments/{other_tournament.id}/", json={"name": "Ghost"}
    ).status_code == 404


def test_update_tournament_is_public(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.patch(f"/tournaments/{td_tournament.id}/", json={"is_public": True})
    assert response.status_code == 200
    assert response.json()["is_public"] is True


# ---------------------------------------------------------------------------
# DELETE /tournaments/{id}/ — owner or admin only
# ---------------------------------------------------------------------------

def test_delete_tournament_owner_can_delete(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/").status_code == 204


def test_delete_tournament_admin_can_delete(client, admin_user, td_tournament):
    login(client, "admin@test.com", "adminpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/").status_code == 204


def test_delete_tournament_non_owner_member_cannot_delete(
    client, td_user, other_tournament, db
):
    grant_role(db, other_tournament, td_user, "tournament_director")
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{other_tournament.id}/").status_code == 403


def test_delete_tournament_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{other_tournament.id}/").status_code == 404


def test_delete_tournament_not_found(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.delete("/tournaments/9999/").status_code == 404
