"""Tests for tournament join-code management endpoints
(app/api/routes/tournament/join_codes.py). Redemption via POST /join/ is
covered in tests/api/test_join.py, alongside the chapter case."""
from datetime import datetime, timedelta, timezone

from tests.conftest import grant_role, login
from app.models.models import JoinCode


def make_join_code(db, tournament_id, created_by, **kwargs):
    defaults = {
        "code": "JOIN1234",
        "label": "Join code",
        "expires_at": None,
        "is_active": True,
    }
    defaults.update(kwargs)
    join_code = JoinCode(
        tournament_id=tournament_id,
        created_by=created_by,
        **defaults,
    )
    db.add(join_code)
    db.commit()
    db.refresh(join_code)
    return join_code


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/join-codes/ — manage_invites
# ---------------------------------------------------------------------------

def test_list_join_codes_td_can_access(client, td_user, td_tournament, db):
    make_join_code(db, td_tournament.id, td_user.id)
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/join-codes/")
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_list_join_codes_volunteer_forbidden(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/join-codes/").status_code == 403


def test_list_join_codes_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/join-codes/").status_code == 404


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/join-codes/ — manage_invites
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

    created = db.query(JoinCode).filter_by(id=data["id"]).first()
    assert created is not None
    assert created.created_by == td_user.id


def test_create_join_code_never_expires_when_omitted(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(f"/tournaments/{td_tournament.id}/join-codes/", json={})
    assert response.status_code == 201
    assert response.json()["expires_at"] is None


def test_create_join_code_volunteer_forbidden(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.post(f"/tournaments/{other_tournament.id}/join-codes/", json={}).status_code == 403


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/join-codes/{code_id}/ — manage_invites
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
# DELETE /tournaments/{tournament_id}/join-codes/{code_id}/ — manage_invites
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


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/staff-invites/ — manage_invites
# mock_send_email is autouse (patches email_service._send), so every test
# here already has it — request it directly to assert on/configure it.
# ---------------------------------------------------------------------------

def test_staff_invite_sends_to_all_and_logs_audit(client, td_user, td_tournament, db, mock_send_email):
    from app.core.tournament.audit import STAFF_INVITE_SENT
    from app.models.models import AuditLogEntry

    join_code = make_join_code(db, td_tournament.id, td_user.id, code="INVITE01")
    login(client, "td@test.com", "tdpass")

    response = client.post(
        f"/tournaments/{td_tournament.id}/staff-invites/",
        json={"join_code_id": join_code.id, "emails": ["a@example.com", "b@example.com"]},
    )
    assert response.status_code == 201
    data = response.json()
    assert sorted(data["sent"]) == ["a@example.com", "b@example.com"]
    assert data["failed"] == []
    assert data["join_code"]["id"] == join_code.id
    assert mock_send_email.call_count == 2

    entry = (
        db.query(AuditLogEntry)
        .filter(AuditLogEntry.tournament_id == td_tournament.id, AuditLogEntry.action == STAFF_INVITE_SENT)
        .first()
    )
    assert entry is not None
    assert entry.target_type == "join_code"
    assert entry.target_id == join_code.id
    assert set(entry.extra_data["emails"]) == {"a@example.com", "b@example.com"}
    assert entry.extra_data["join_code"] == join_code.code
    assert "failed" not in entry.extra_data


def test_staff_invite_partial_failure_reported(client, td_user, td_tournament, db, mock_send_email):
    from app.core.tournament.audit import STAFF_INVITE_SENT
    from app.models.models import AuditLogEntry

    join_code = make_join_code(db, td_tournament.id, td_user.id, code="INVITE02")
    login(client, "td@test.com", "tdpass")

    async def flaky_send(to, subject, text, html):
        if to == "bad@example.com":
            raise RuntimeError("Resend rejected this address")

    mock_send_email.side_effect = flaky_send

    response = client.post(
        f"/tournaments/{td_tournament.id}/staff-invites/",
        json={"join_code_id": join_code.id, "emails": ["good@example.com", "bad@example.com"]},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["sent"] == ["good@example.com"]
    assert data["failed"] == ["bad@example.com"]

    entry = (
        db.query(AuditLogEntry)
        .filter(AuditLogEntry.tournament_id == td_tournament.id, AuditLogEntry.action == STAFF_INVITE_SENT)
        .first()
    )
    assert entry.extra_data["failed"] == ["bad@example.com"]


def test_staff_invite_join_code_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/staff-invites/",
        json={"join_code_id": 9999, "emails": ["a@example.com"]},
    )
    assert response.status_code == 404


def test_staff_invite_join_code_wrong_tournament(client, td_user, td_tournament, other_tournament, other_user, db):
    join_code = make_join_code(db, other_tournament.id, other_user.id, code="WRONGTN1")
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/staff-invites/",
        json={"join_code_id": join_code.id, "emails": ["a@example.com"]},
    )
    assert response.status_code == 404


def test_staff_invite_volunteer_forbidden(client, td_user, other_tournament, db):
    join_code = make_join_code(db, other_tournament.id, td_user.id, code="FORBID01")
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{other_tournament.id}/staff-invites/",
        json={"join_code_id": join_code.id, "emails": ["a@example.com"]},
    )
    assert response.status_code == 403


def test_staff_invite_non_member_gets_404(client, td_user, other_tournament, other_user, db):
    join_code = make_join_code(db, other_tournament.id, other_user.id, code="NONMEM01")
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{other_tournament.id}/staff-invites/",
        json={"join_code_id": join_code.id, "emails": ["a@example.com"]},
    )
    assert response.status_code == 404


def test_staff_invite_unauthenticated(client, td_tournament, td_user, db):
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="NOAUTH01")
    response = client.post(
        f"/tournaments/{td_tournament.id}/staff-invites/",
        json={"join_code_id": join_code.id, "emails": ["a@example.com"]},
    )
    assert response.status_code == 401
