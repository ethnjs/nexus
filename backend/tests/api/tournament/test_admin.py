"""Tests for /admin/tournaments/ endpoints (app/api/routes/tournament/admin.py)."""
from app.core.tournament.audit import TOURNAMENT_VERIFIED
from app.models.models import AuditLogEntry
from tests.conftest import grant_role, login


# ---------------------------------------------------------------------------
# GET /admin/tournaments/ — platform admin only (global list)
# ---------------------------------------------------------------------------

def test_list_all_tournaments_admin_only(client, admin_user, td_user, td_tournament):
    login(client, "admin@test.com", "adminpass")
    response = client.get("/admin/tournaments/")
    assert response.status_code == 200
    assert any(t["id"] == td_tournament.id for t in response.json())


def test_list_all_tournaments_non_admin_forbidden(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get("/admin/tournaments/").status_code == 403


def test_list_all_tournaments_unauthenticated(client):
    assert client.get("/admin/tournaments/").status_code == 401


def test_list_all_tournaments_carries_owner(client, admin_user, td_user, td_tournament):
    """The admin audience is the only one that identifies an owner by name —
    TournamentRead gives members owner_id and nothing more."""
    login(client, "admin@test.com", "adminpass")
    row = next(t for t in client.get("/admin/tournaments/").json() if t["id"] == td_tournament.id)
    assert row["owner"]["id"] == td_tournament.owner_id
    assert row["owner"]["email"] == td_user.email


def test_list_all_tournaments_carries_counts(
    client, admin_user, td_user, td_tournament, db
):
    login(client, "admin@test.com", "adminpass")
    row = next(t for t in client.get("/admin/tournaments/").json() if t["id"] == td_tournament.id)
    # The owner's own membership is the one volunteer.
    assert row["volunteer_count"] == 1
    assert row["event_count"] == len(td_tournament.events)


def test_list_all_tournaments_counts_exclude_declined(
    client, admin_user, td_user, td_tournament, db
):
    """A declined membership row still exists but isn't a volunteer — the
    grouped count has to match is_declined()."""
    from app.models.models import TournamentMembership

    grant_role(db, td_tournament, admin_user, "Volunteer")
    membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == td_tournament.id,
            TournamentMembership.user_id == admin_user.id,
        )
        .first()
    )
    membership.age_disclosure = "declined"
    db.commit()

    login(client, "admin@test.com", "adminpass")
    row = next(t for t in client.get("/admin/tournaments/").json() if t["id"] == td_tournament.id)
    assert row["volunteer_count"] == 1


def test_list_all_tournaments_zero_counts_present(client, admin_user, td_tournament):
    """A tournament with nothing to count still reports 0 rather than
    omitting the field — tournament_counts seeds every id it is given."""
    login(client, "admin@test.com", "adminpass")
    row = next(t for t in client.get("/admin/tournaments/").json() if t["id"] == td_tournament.id)
    assert isinstance(row["event_count"], int)
    assert isinstance(row["volunteer_count"], int)


# ---------------------------------------------------------------------------
# PATCH /admin/tournaments/{id}/verify/ — platform admin only
# The one route that can flip is_verified; a tournament's own TD must never
# be able to self-verify.
# ---------------------------------------------------------------------------

def test_verify_tournament_admin_can_set(client, admin_user, td_tournament, db):
    login(client, "admin@test.com", "adminpass")
    response = client.patch(
        f"/admin/tournaments/{td_tournament.id}/verify/", json={"is_verified": True}
    )
    assert response.status_code == 200
    assert response.json()["is_verified"] is True

    db.refresh(td_tournament)
    assert td_tournament.is_verified is True


def test_verify_tournament_rejected_on_archived_tournament(client, admin_user, td_tournament, db):
    td_tournament.is_archived = True
    db.commit()
    login(client, "admin@test.com", "adminpass")
    response = client.patch(
        f"/admin/tournaments/{td_tournament.id}/verify/", json={"is_verified": True}
    )
    assert response.status_code == 403


def test_verify_tournament_admin_can_unset(client, admin_user, td_tournament, db):
    td_tournament.is_verified = True
    db.commit()

    login(client, "admin@test.com", "adminpass")
    response = client.patch(
        f"/admin/tournaments/{td_tournament.id}/verify/", json={"is_verified": False}
    )
    assert response.status_code == 200
    assert response.json()["is_verified"] is False


def test_verify_tournament_owner_forbidden(client, td_user, td_tournament):
    """Owning the tournament grants no platform-admin powers."""
    login(client, "td@test.com", "tdpass")
    assert client.patch(
        f"/admin/tournaments/{td_tournament.id}/verify/", json={"is_verified": True}
    ).status_code == 403


def test_verify_tournament_unauthenticated(client, td_tournament):
    assert client.patch(
        f"/admin/tournaments/{td_tournament.id}/verify/", json={"is_verified": True}
    ).status_code == 401


def test_verify_tournament_not_found(client, admin_user):
    login(client, "admin@test.com", "adminpass")
    assert client.patch(
        "/admin/tournaments/9999/verify/", json={"is_verified": True}
    ).status_code == 404


def test_verify_tournament_writes_audit_entry(client, admin_user, td_tournament, db):
    """Logged into the tournament's own audit log even though the actor is a
    platform admin with no membership in it."""
    login(client, "admin@test.com", "adminpass")
    client.patch(f"/admin/tournaments/{td_tournament.id}/verify/", json={"is_verified": True})

    entry = (
        db.query(AuditLogEntry)
        .filter(
            AuditLogEntry.tournament_id == td_tournament.id,
            AuditLogEntry.action == TOURNAMENT_VERIFIED,
        )
        .one()
    )
    assert entry.actor_id == admin_user.id
    assert entry.extra_data == {"is_verified": True}
