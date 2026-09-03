"""Tests for /tournaments/ core CRUD endpoints (app/api/routes/tournament/__init__.py)."""
from datetime import date, timedelta

from tests.conftest import TOURNAMENT_REQUIRED_FIELDS, future_date, grant_role, login
from app.core.tournament.audit import (
    OWNERSHIP_TRANSFERRED, TOURNAMENT_ARCHIVED, TOURNAMENT_UNARCHIVED,
)
from app.models.models import (
    AuditLogEntry, JoinCode, TournamentMembership, TournamentMembershipRole,
    TournamentRole, University,
)

# Required fields every TournamentCreate payload needs now (state/level/division
# + non-null dates). Tests that only care about other fields spread this in.
REQUIRED_FIELDS = TOURNAMENT_REQUIRED_FIELDS


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
    grant_role(db, other_tournament, td_user, "Volunteer")
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


def test_list_my_tournaments_returns_summary_shape(
    client, td_user, td_tournament, other_user, db
):
    """TournamentSummary — event_count/volunteer_count computed, no
    roles/owner_id leaked (those belong to the full TournamentRead detail)."""
    login(client, "td@test.com", "tdpass")
    client.post(f"/tournaments/{td_tournament.id}/events/", json={
        "tournament_id": td_tournament.id,
        "name": "Boomilever",
        "division": "C",
        "start_time": date.today().isoformat() + "T08:00:00Z",
        "end_time": date.today().isoformat() + "T12:00:00Z",
    })
    grant_role(db, td_tournament, other_user, "Volunteer")

    data = client.get("/tournaments/me/").json()
    summary = next(t for t in data if t["id"] == td_tournament.id)

    assert summary["event_count"] == 1
    assert summary["volunteer_count"] == 2  # owner (td_user) + other_user
    assert "roles" not in summary
    assert "owner_id" not in summary


def test_list_my_tournaments_excludes_declined_membership(client, td_tournament, other_user, db):
    """A declined membership is inactive — blocked from the dashboard listing
    just like every other tournament page."""
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "other@test.com", "otherpass")
    ids = [t["id"] for t in client.get("/tournaments/me/").json()]
    assert td_tournament.id not in ids


def test_volunteer_count_excludes_declined_membership(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "td@test.com", "tdpass")
    data = client.get("/tournaments/me/").json()
    summary = next(t for t in data if t["id"] == td_tournament.id)
    assert summary["volunteer_count"] == 1  # just the owner — other_user declined


# ---------------------------------------------------------------------------
# POST /tournaments/ — any authenticated user
# ---------------------------------------------------------------------------

def test_create_tournament_minimal(client, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={
        "name": "Minimal Tournament", "location": "Test Location", **REQUIRED_FIELDS,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Minimal Tournament"
    assert data["is_public"] is False
    assert data["is_verified"] is False


def test_create_tournament_has_zero_roles(client, td_user):
    """New tournaments start with zero TournamentRole rows — the owner has
    full permissions via owner_id, and sets up roles later via apply-template
    or custom creation."""
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={
        "name": "Auto Roles", "location": "Test Location", **REQUIRED_FIELDS,
    })
    assert response.status_code == 201
    assert response.json()["roles"] == []


def test_create_tournament_auto_creates_membership_with_no_roles(client, td_user, db):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={
        "name": "Auto TournamentMembership", "location": "Test Location", **REQUIRED_FIELDS,
    })
    assert response.status_code == 201
    tournament_id = response.json()["id"]
    membership = db.query(TournamentMembership).filter(
        TournamentMembership.user_id == td_user.id,
        TournamentMembership.tournament_id == tournament_id,
    ).first()
    assert membership is not None
    roles_held = (
        db.query(TournamentRole)
        .join(TournamentMembershipRole, TournamentMembershipRole.role_id == TournamentRole.id)
        .filter(TournamentMembershipRole.membership_id == membership.id)
        .all()
    )
    assert roles_held == []


def test_create_tournament_full(client, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post("/tournaments/", json={
        "name": "Nationals",
        "start_date": future_date(5, 21),
        "end_date": future_date(5, 23),
        "location": "USC",
        "state": "Southern California",
        "level": "nationals",
        "division": ["B", "C"],
        "timezone": "America/Los_Angeles",
        "is_public": True,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Nationals"
    assert data["is_public"] is True


def test_create_tournament_invalid_dates(client, td_user):
    """end_date before start_date. Both dates are in the future so this can only
    trip the end<start rule — with past dates it would 422 either way and the
    test would still pass with that validator deleted."""
    login(client, "td@test.com", "tdpass")
    assert client.post("/tournaments/", json={
        **REQUIRED_FIELDS,
        "name": "Bad Dates",
        "start_date": future_date(11, 15),
        "end_date": future_date(11, 14),
        "location": "Test Location",
    }).status_code == 422


def test_create_tournament_name_with_number_rejected(client, td_user):
    """name must exclude the year — it's derived from start_date instead."""
    login(client, "td@test.com", "tdpass")
    assert client.post("/tournaments/", json={
        **REQUIRED_FIELDS,
        "name": "Nationals 2025",
        "location": "Test Location",
    }).status_code == 422


def test_create_tournament_invalid_state_rejected(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.post("/tournaments/", json={
        **REQUIRED_FIELDS,
        "name": "Bad State",
        "location": "Test Location",
        "state": "California",  # not valid — must be Southern/Northern California
    }).status_code == 422


def test_create_tournament_both_location_and_university_id_rejected(client, td_user, db):
    university = University(name="MIT")
    db.add(university)
    db.commit()

    login(client, "td@test.com", "tdpass")
    assert client.post("/tournaments/", json={
        **REQUIRED_FIELDS,
        "name": "Both Sources",
        "location": "Test Location",
        "university_id": university.id,
    }).status_code == 422


def test_create_tournament_neither_location_nor_university_id_rejected(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.post("/tournaments/", json={
        **REQUIRED_FIELDS,
        "name": "No Source",
    }).status_code == 422


def test_create_tournament_invalid_division_rejected(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.post("/tournaments/", json={
        **REQUIRED_FIELDS,
        "name": "Bad Division",
        "location": "Test Location",
        "division": ["D"],
    }).status_code == 422


def test_create_tournament_unauthenticated(client):
    assert client.post("/tournaments/", json={
        "name": "Sneaky", "location": "Nowhere", **REQUIRED_FIELDS,
    }).status_code == 401


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
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/").status_code == 200


def test_get_tournament_not_found(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/tournaments/9999/").status_code == 404


def test_get_tournament_declined_member_gets_404(client, other_tournament, other_user, db):
    """A declined membership doesn't count for require_membership() — blocked
    from tournament pages generally, not just the roster."""
    membership = grant_role(db, other_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "other@test.com", "otherpass")
    assert client.get(f"/tournaments/{other_tournament.id}/").status_code == 404


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
    grant_role(db, other_tournament, td_user, "Volunteer")
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
# Age disclosure collection toggles — manage_tournament read/write
# ---------------------------------------------------------------------------

def test_update_tournament_sets_collection_toggles(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/",
        json={"collect_is_over_18": True, "collect_is_over_21": True},
    )
    assert response.status_code == 200
    assert response.json()["collect_is_over_18"] is True
    assert response.json()["collect_is_over_21"] is True


def test_update_tournament_toggles_default_false(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/").json()
    assert data["collect_is_over_18"] is False
    assert data["collect_is_over_21"] is False


def test_update_tournament_toggles_require_manage_tournament(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{other_tournament.id}/", json={"collect_is_over_18": True},
    )
    assert response.status_code == 403


def test_turning_toggle_on_does_not_retroactively_expose_unconsented_members(
    client, td_user, td_tournament, other_user, db,
):
    """The whole privacy promise of this feature: an existing member who
    never answered the consent prompt stays hidden the instant a TD flips
    the toggle on — 2.3's gate keys off consent, not collection alone, but
    this proves the two combine correctly end to end."""
    other_user.date_of_birth = date(2000, 1, 1)
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "td@test.com", "tdpass")

    # Before: not collected, unanswered — omitted either way.
    data = client.get(f"/tournaments/{td_tournament.id}/members/{membership.id}/").json()
    assert "is_over_18" not in data

    # TD turns it on.
    response = client.patch(f"/tournaments/{td_tournament.id}/", json={"collect_is_over_18": True})
    assert response.status_code == 200

    # After: collected now, but still never consented — still omitted, not null.
    data = client.get(f"/tournaments/{td_tournament.id}/members/{membership.id}/").json()
    assert "is_over_18" not in data


def test_update_tournament_both_location_and_university_id_rejected(client, td_user, td_tournament, db):
    university = University(name="MIT")
    db.add(university)
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.patch(f"/tournaments/{td_tournament.id}/", json={
        "location": "Somewhere",
        "university_id": university.id,
    })
    assert response.status_code == 422


def test_update_tournament_university_id_conflicts_with_existing_location_rejected(
    client, td_user, td_tournament, db
):
    """td_tournament already has location set (see conftest) — patching in a
    university_id without clearing location hits Tournament.validate_tournament_source
    in models.py, not the TournamentUpdate schema (which only sees this patch,
    not the tournament's existing row)."""
    university = University(name="MIT")
    db.add(university)
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.patch(f"/tournaments/{td_tournament.id}/", json={
        "university_id": university.id,
    })
    assert response.status_code == 400


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
    grant_role(db, other_tournament, td_user, "Tournament Director")
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{other_tournament.id}/").status_code == 403


def test_delete_tournament_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{other_tournament.id}/").status_code == 404


def test_delete_tournament_not_found(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.delete("/tournaments/9999/").status_code == 404


# ---------------------------------------------------------------------------
# POST /tournaments/{id}/archive/ — owner or admin only
# ---------------------------------------------------------------------------

def _make_join_code(db, tournament_id, created_by, code="ARCHIVE1"):
    join_code = JoinCode(
        tournament_id=tournament_id, created_by=created_by,
        code=code, label="Join code", expires_at=None, is_active=True,
    )
    db.add(join_code)
    db.commit()
    return join_code


def test_archive_tournament_owner_can_archive(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/archive/")
    assert response.status_code == 200
    assert response.json()["is_archived"] is True


def test_archive_tournament_admin_can_archive(client, admin_user, td_tournament):
    login(client, "admin@test.com", "adminpass")
    assert client.post(f"/tournaments/{td_tournament.id}/archive/").status_code == 200


def test_archive_tournament_non_owner_member_cannot_archive(client, td_user, other_tournament, db):
    """Even a Tournament Director (manage_tournament) can't archive — archive is
    gated on ownership, not permission."""
    grant_role(db, other_tournament, td_user, "Tournament Director")
    login(client, "td@test.com", "tdpass")
    assert client.post(f"/tournaments/{other_tournament.id}/archive/").status_code == 403


def test_archive_tournament_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.post(f"/tournaments/{other_tournament.id}/archive/").status_code == 404


def test_archive_tournament_deactivates_join_codes(client, td_user, td_tournament, db):
    """An archived tournament shouldn't still be joinable."""
    join_code = _make_join_code(db, td_tournament.id, td_user.id)
    login(client, "td@test.com", "tdpass")
    assert client.post(f"/tournaments/{td_tournament.id}/archive/").status_code == 200

    db.refresh(join_code)
    assert join_code.is_active is False


def test_archive_tournament_writes_audit_entry(client, td_user, td_tournament, db):
    login(client, "td@test.com", "tdpass")
    client.post(f"/tournaments/{td_tournament.id}/archive/")

    entry = (
        db.query(AuditLogEntry)
        .filter(
            AuditLogEntry.tournament_id == td_tournament.id,
            AuditLogEntry.action == TOURNAMENT_ARCHIVED,
        )
        .one()
    )
    assert entry.actor_id == td_user.id
    assert entry.target_type == "tournament"
    assert entry.target_id == td_tournament.id


def test_archived_tournament_rejects_patch(client, td_user, td_tournament):
    """require_not_archived — archived tournaments stay readable but frozen."""
    login(client, "td@test.com", "tdpass")
    client.post(f"/tournaments/{td_tournament.id}/archive/")

    assert client.patch(
        f"/tournaments/{td_tournament.id}/", json={"name": "Renamed"}
    ).status_code == 403


def test_archived_tournament_still_readable(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    client.post(f"/tournaments/{td_tournament.id}/archive/")

    response = client.get(f"/tournaments/{td_tournament.id}/")
    assert response.status_code == 200
    assert response.json()["is_archived"] is True


def test_archived_tournament_rejects_delete(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    client.post(f"/tournaments/{td_tournament.id}/archive/")

    assert client.delete(f"/tournaments/{td_tournament.id}/").status_code == 403


# ---------------------------------------------------------------------------
# POST /tournaments/{id}/unarchive/ — owner or admin, admin-only once ended
# ---------------------------------------------------------------------------

def _end_tournament(db, tournament):
    """Push both dates into the past so the tournament counts as ended.
    Assigned directly rather than via PATCH — the API rejects past dates."""
    tournament.start_date = date.today() - timedelta(days=10)
    tournament.end_date = date.today() - timedelta(days=9)
    db.commit()


def test_unarchive_tournament_owner_can_unarchive_before_end_date(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    client.post(f"/tournaments/{td_tournament.id}/archive/")

    response = client.post(f"/tournaments/{td_tournament.id}/unarchive/")
    assert response.status_code == 200
    assert response.json()["is_archived"] is False


def test_unarchive_tournament_owner_forbidden_once_ended(client, td_user, td_tournament, db):
    """A tournament past its end_date is a historical record — admin only."""
    login(client, "td@test.com", "tdpass")
    client.post(f"/tournaments/{td_tournament.id}/archive/")
    _end_tournament(db, td_tournament)

    response = client.post(f"/tournaments/{td_tournament.id}/unarchive/")
    assert response.status_code == 403
    assert "admin" in response.json()["detail"].lower()


def test_unarchive_tournament_admin_can_unarchive_ended(client, admin_user, td_tournament, db):
    _end_tournament(db, td_tournament)
    login(client, "admin@test.com", "adminpass")
    td_tournament.is_archived = True
    db.commit()

    response = client.post(f"/tournaments/{td_tournament.id}/unarchive/")
    assert response.status_code == 200
    assert response.json()["is_archived"] is False


def test_unarchive_ended_tournament_sets_archive_override(client, admin_user, td_tournament, db):
    """archive_override_at stops the auto-archive job from immediately
    re-archiving a tournament an admin just pulled back out."""
    _end_tournament(db, td_tournament)
    td_tournament.is_archived = True
    db.commit()

    login(client, "admin@test.com", "adminpass")
    client.post(f"/tournaments/{td_tournament.id}/unarchive/")

    db.refresh(td_tournament)
    assert td_tournament.archive_override_at is not None


def test_unarchive_before_end_date_leaves_override_unset(client, td_user, td_tournament, db):
    """Only an ended tournament needs the override — a manual archive doesn't."""
    login(client, "td@test.com", "tdpass")
    client.post(f"/tournaments/{td_tournament.id}/archive/")
    client.post(f"/tournaments/{td_tournament.id}/unarchive/")

    db.refresh(td_tournament)
    assert td_tournament.archive_override_at is None


def test_unarchive_tournament_non_owner_member_forbidden(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Tournament Director")
    other_tournament.is_archived = True
    db.commit()

    login(client, "td@test.com", "tdpass")
    assert client.post(f"/tournaments/{other_tournament.id}/unarchive/").status_code == 403


def test_unarchive_tournament_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.post(f"/tournaments/{other_tournament.id}/unarchive/").status_code == 404


def test_unarchive_tournament_writes_audit_entry(client, td_user, td_tournament, db):
    login(client, "td@test.com", "tdpass")
    client.post(f"/tournaments/{td_tournament.id}/archive/")
    client.post(f"/tournaments/{td_tournament.id}/unarchive/")

    entry = (
        db.query(AuditLogEntry)
        .filter(
            AuditLogEntry.tournament_id == td_tournament.id,
            AuditLogEntry.action == TOURNAMENT_UNARCHIVED,
        )
        .one()
    )
    assert entry.actor_id == td_user.id


# ---------------------------------------------------------------------------
# POST /tournaments/{id}/transfer-ownership/ — owner only
# ---------------------------------------------------------------------------

def test_transfer_ownership_owner_can_transfer(client, td_user, td_tournament, other_user, db):
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "td@test.com", "tdpass")

    response = client.post(
        f"/tournaments/{td_tournament.id}/transfer-ownership/",
        json={"new_owner_id": other_user.id},
    )
    assert response.status_code == 200
    assert response.json()["owner_id"] == other_user.id


def test_transfer_ownership_requires_new_owner_membership(client, td_user, td_tournament, other_user):
    """Can't hand a tournament to someone who isn't in it."""
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/transfer-ownership/",
        json={"new_owner_id": other_user.id},
    )
    assert response.status_code == 400


def test_transfer_ownership_rejects_declined_new_owner(client, td_user, td_tournament, other_user, db):
    """A declined membership doesn't count as "already a member" for
    transfer eligibility — same treatment as everywhere else declined."""
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/transfer-ownership/",
        json={"new_owner_id": other_user.id},
    )
    assert response.status_code == 400


def test_transfer_ownership_non_owner_member_forbidden(client, td_user, other_tournament, db):
    """manage_tournament isn't enough — transfer is owner-only."""
    grant_role(db, other_tournament, td_user, "Tournament Director")
    login(client, "td@test.com", "tdpass")

    response = client.post(
        f"/tournaments/{other_tournament.id}/transfer-ownership/",
        json={"new_owner_id": td_user.id},
    )
    assert response.status_code == 403


def test_transfer_ownership_non_member_gets_404(client, td_user, other_tournament, other_user):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{other_tournament.id}/transfer-ownership/",
        json={"new_owner_id": other_user.id},
    )
    assert response.status_code == 404


def test_transfer_ownership_old_owner_keeps_roles(client, td_user, td_tournament, other_user, db):
    """Transfer moves owner_id only — no roles are auto-added or auto-removed."""
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    client.post(
        f"/tournaments/{td_tournament.id}/transfer-ownership/",
        json={"new_owner_id": other_user.id},
    )

    old_owner_membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == td_tournament.id,
            TournamentMembership.user_id == td_user.id,
        )
        .one()
    )
    labels = [
        db.query(TournamentRole).filter(TournamentRole.id == r.role_id).one().label
        for r in old_owner_membership.roles
    ]
    assert labels == ["Tournament Director"]


def test_transfer_ownership_logs_both_parties(client, td_user, td_tournament, other_user, db):
    """extra_data carries old/new names so the log stays readable after a
    user is renamed or deleted."""
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    client.post(
        f"/tournaments/{td_tournament.id}/transfer-ownership/",
        json={"new_owner_id": other_user.id},
    )

    entry = (
        db.query(AuditLogEntry)
        .filter(
            AuditLogEntry.tournament_id == td_tournament.id,
            AuditLogEntry.action == OWNERSHIP_TRANSFERRED,
        )
        .one()
    )
    assert entry.extra_data["old"]["id"] == td_user.id
    assert entry.extra_data["new"]["id"] == other_user.id
    assert entry.extra_data["new"]["name"] == "Other User"
