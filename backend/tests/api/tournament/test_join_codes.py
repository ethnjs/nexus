"""Tests for tournament join-code management endpoints
(app/api/routes/tournament/join_codes.py). Redemption via POST /join/ is
covered in tests/api/test_join.py, alongside the chapter case."""

from datetime import UTC, datetime, timedelta

from app.core.tournament.audit import (
    INVITE_EMAIL_SENT,
    JOIN_CODE_CREATED,
    JOIN_CODE_UPDATED,
    log_action,
)
from app.models.models import AuditLogEntry, JoinCode, TournamentRole
from tests.conftest import grant_role, login


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


def test_list_join_codes_hides_expired(client, td_user, td_tournament, db):
    now = datetime.now(UTC)
    live = make_join_code(
        db, td_tournament.id, td_user.id, code="LIVE1234", expires_at=now + timedelta(hours=1)
    )
    make_join_code(
        db, td_tournament.id, td_user.id, code="GONE1234", expires_at=now - timedelta(hours=1)
    )
    forever = make_join_code(db, td_tournament.id, td_user.id, code="FORE1234")
    login(client, "td@test.com", "tdpass")

    ids = {c["id"] for c in client.get(f"/tournaments/{td_tournament.id}/join-codes/").json()}

    assert ids == {live.id, forever.id}


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
    assert (
        client.post(f"/tournaments/{other_tournament.id}/join-codes/", json={}).status_code == 403
    )


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/join-codes/{code_id}/ — manage_invites
# ---------------------------------------------------------------------------


def test_update_join_code_label_only(client, td_user, td_tournament, db):
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="LABELUP1")
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/join-codes/{join_code.id}/",
        json={"label": "Updated Label"},
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
    base = datetime.now(UTC) + timedelta(hours=1)
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
    assert (
        client.patch(
            f"/tournaments/{td_tournament.id}/join-codes/9999/", json={"label": "Ghost"}
        ).status_code
        == 404
    )


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/join-codes/{code_id}/ — manage_invites
# ---------------------------------------------------------------------------


def test_deactivate_join_code_marks_inactive(client, td_user, td_tournament, db):
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="DEACT001")
    login(client, "td@test.com", "tdpass")

    assert (
        client.delete(f"/tournaments/{td_tournament.id}/join-codes/{join_code.id}/").status_code
        == 204
    )

    db.refresh(join_code)
    assert join_code.is_active is False


def test_deactivate_join_code_twice_rejected(client, td_user, td_tournament, db):
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="DEACT002", is_active=False)
    login(client, "td@test.com", "tdpass")

    assert (
        client.delete(f"/tournaments/{td_tournament.id}/join-codes/{join_code.id}/").status_code
        == 400
    )


def test_deactivate_join_code_not_found(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{td_tournament.id}/join-codes/9999/").status_code == 404


# ---------------------------------------------------------------------------
# Invite roles — set on POST and PATCH /join-codes/, granted on redeem
# ---------------------------------------------------------------------------


def _role(db, tournament, label):
    return db.query(TournamentRole).filter_by(tournament_id=tournament.id, label=label).one()


def _invites_only_role(db, tournament):
    role = TournamentRole(
        tournament_id=tournament.id, label="Invites only", permissions=["manage_invites"], rank=45
    )
    db.add(role)
    db.commit()
    return role


def test_create_join_code_with_roles(client, td_user, td_tournament, db):
    volunteer = _role(db, td_tournament, "Volunteer")
    login(client, "td@test.com", "tdpass")

    response = client.post(
        f"/tournaments/{td_tournament.id}/join-codes/", json={"role_ids": [volunteer.id]}
    )

    assert response.status_code == 201
    assert response.json()["roles"] == [
        {"id": volunteer.id, "label": "Volunteer", "has_permissions": False}
    ]
    entry = db.query(AuditLogEntry).filter_by(action=JOIN_CODE_CREATED).one()
    assert entry.extra_data["roles"] == ["Volunteer"]


def test_create_join_code_rejects_role_with_permissions(client, td_user, td_tournament, db):
    director = _role(db, td_tournament, "Tournament Director")
    login(client, "td@test.com", "tdpass")

    response = client.post(
        f"/tournaments/{td_tournament.id}/join-codes/", json={"role_ids": [director.id]}
    )

    assert response.status_code == 422


def test_create_join_code_rejects_other_tournaments_role(
    client, td_user, td_tournament, other_tournament, db
):
    foreign = _role(db, other_tournament, "Volunteer")
    login(client, "td@test.com", "tdpass")

    response = client.post(
        f"/tournaments/{td_tournament.id}/join-codes/", json={"role_ids": [foreign.id]}
    )

    assert response.status_code == 404


def test_invite_roles_need_manage_members(client, td_user, other_tournament, db):
    """manage_invites alone creates plain invites, but setting roles grants them."""
    _invites_only_role(db, other_tournament)
    grant_role(db, other_tournament, td_user, "Invites only")
    volunteer = _role(db, other_tournament, "Volunteer")
    join_code = make_join_code(
        db, other_tournament.id, td_user.id, code="ROLEGATE", roles=[volunteer]
    )
    login(client, "td@test.com", "tdpass")
    base = f"/tournaments/{other_tournament.id}/join-codes/"

    assert client.post(base, json={}).status_code == 201
    assert client.post(base, json={"role_ids": [volunteer.id]}).status_code == 403
    assert client.patch(f"{base}{join_code.id}/", json={"role_ids": []}).status_code == 403
    # Resending the same roles alongside a label edit isn't a role change.
    response = client.patch(
        f"{base}{join_code.id}/", json={"label": "Renamed", "role_ids": [volunteer.id]}
    )
    assert response.status_code == 200


def test_update_join_code_replaces_roles(client, td_user, td_tournament, db):
    volunteer = _role(db, td_tournament, "Volunteer")
    writer = _role(db, td_tournament, "Test Writer")
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="ROLESWAP", roles=[volunteer])
    login(client, "td@test.com", "tdpass")

    response = client.patch(
        f"/tournaments/{td_tournament.id}/join-codes/{join_code.id}/",
        json={"role_ids": [writer.id]},
    )

    assert response.status_code == 200
    assert [r["id"] for r in response.json()["roles"]] == [writer.id]
    entry = db.query(AuditLogEntry).filter_by(action=JOIN_CODE_UPDATED).one()
    assert entry.extra_data["changes"]["roles"] == {"old": ["Volunteer"], "new": ["Test Writer"]}


def test_list_join_codes_flags_role_that_gained_permissions(client, td_user, td_tournament, db):
    volunteer = _role(db, td_tournament, "Volunteer")
    make_join_code(db, td_tournament.id, td_user.id, code="ROLEFLAG", roles=[volunteer])
    volunteer.permissions = ["manage_events"]
    db.commit()
    login(client, "td@test.com", "tdpass")

    codes = client.get(f"/tournaments/{td_tournament.id}/join-codes/").json()

    assert codes[0]["roles"] == [
        {"id": volunteer.id, "label": "Volunteer", "has_permissions": True}
    ]


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/join-codes/{code_id}/emails/ — manage_invites
# mock_send_email is autouse (patches email_service._send), so every test
# here already has it — request it directly to assert on/configure it.
# ---------------------------------------------------------------------------


def _emails_url(tournament_id, code_id):
    return f"/tournaments/{tournament_id}/join-codes/{code_id}/emails/"


def test_invite_email_sends_to_each_and_logs_audit(
    client, td_user, td_tournament, db, mock_send_email
):
    volunteer = _role(db, td_tournament, "Volunteer")
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="INVITE01", roles=[volunteer])
    login(client, "td@test.com", "tdpass")

    response = client.post(
        _emails_url(td_tournament.id, join_code.id),
        json={"emails": ["a@example.com", "B@example.com", "b@example.com"]},
    )

    assert response.status_code == 201
    assert response.json() == {"sent": ["a@example.com", "b@example.com"], "failed": []}
    assert mock_send_email.call_count == 2
    assert "You'll join as Volunteer." in mock_send_email.call_args.args[2]

    entry = db.query(AuditLogEntry).filter_by(action=INVITE_EMAIL_SENT).one()
    assert entry.target_type == "join_code"
    assert entry.target_id == join_code.id
    assert entry.extra_data == {
        "join_code": "INVITE01",
        "label": "Join code",
        "recipients": [
            {"email": "a@example.com", "status": "sent"},
            {"email": "b@example.com", "status": "sent"},
        ],
    }


def test_invite_email_partial_failure_reported(client, td_user, td_tournament, db, mock_send_email):
    join_code = make_join_code(db, td_tournament.id, td_user.id, code="INVITE02")
    login(client, "td@test.com", "tdpass")

    async def flaky_send(to, subject, text, html):
        if to == "bad@example.com":
            raise RuntimeError("Resend rejected this address")

    mock_send_email.side_effect = flaky_send

    response = client.post(
        _emails_url(td_tournament.id, join_code.id),
        json={"emails": ["good@example.com", "bad@example.com"]},
    )

    assert response.status_code == 201
    assert response.json() == {"sent": ["good@example.com"], "failed": ["bad@example.com"]}
    entry = db.query(AuditLogEntry).filter_by(action=INVITE_EMAIL_SENT).one()
    assert entry.extra_data["recipients"][1] == {"email": "bad@example.com", "status": "failed"}


def test_invite_email_manage_invites_is_enough(client, td_user, other_tournament, db):
    """Not owner-only: any role with manage_invites can send."""
    _invites_only_role(db, other_tournament)
    grant_role(db, other_tournament, td_user, "Invites only")
    join_code = make_join_code(db, other_tournament.id, td_user.id, code="MANAGE01")
    login(client, "td@test.com", "tdpass")

    response = client.post(
        _emails_url(other_tournament.id, join_code.id), json={"emails": ["a@example.com"]}
    )

    assert response.status_code == 201


def test_invite_email_refuses_dead_invite(client, td_user, td_tournament, db):
    inactive = make_join_code(db, td_tournament.id, td_user.id, code="DEAD0001", is_active=False)
    expired = make_join_code(
        db,
        td_tournament.id,
        td_user.id,
        code="DEAD0002",
        expires_at=datetime.now(UTC) - timedelta(hours=1),
    )
    login(client, "td@test.com", "tdpass")

    for join_code in (inactive, expired):
        response = client.post(
            _emails_url(td_tournament.id, join_code.id), json={"emails": ["a@example.com"]}
        )
        assert response.status_code == 400


def test_invite_email_join_code_wrong_tournament(
    client, td_user, td_tournament, other_tournament, other_user, db
):
    join_code = make_join_code(db, other_tournament.id, other_user.id, code="WRONGTN1")
    login(client, "td@test.com", "tdpass")

    response = client.post(
        _emails_url(td_tournament.id, join_code.id), json={"emails": ["a@example.com"]}
    )

    assert response.status_code == 404


def test_invite_email_volunteer_forbidden(client, td_user, other_tournament, db):
    join_code = make_join_code(db, other_tournament.id, td_user.id, code="FORBID01")
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")

    response = client.post(
        _emails_url(other_tournament.id, join_code.id), json={"emails": ["a@example.com"]}
    )

    assert response.status_code == 403


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/join-codes/emails/ — manage_invites
# ---------------------------------------------------------------------------


def test_list_invite_emails_one_row_per_recipient(
    client, td_user, td_tournament, other_tournament, other_user, db
):
    first = make_join_code(db, td_tournament.id, td_user.id, code="HIST0001")
    second = make_join_code(db, td_tournament.id, td_user.id, code="HIST0002", label=None)
    foreign = make_join_code(db, other_tournament.id, other_user.id, code="HIST0003")
    login(client, "td@test.com", "tdpass")
    client.post(_emails_url(td_tournament.id, first.id), json={"emails": ["a@example.com"]})
    client.post(
        _emails_url(td_tournament.id, second.id),
        json={"emails": ["b@example.com", "c@example.com"]},
    )
    log_action(
        db,
        other_tournament.id,
        other_user.id,
        INVITE_EMAIL_SENT,
        target_type="join_code",
        target_id=foreign.id,
        extra_data={
            "join_code": "HIST0003",
            "label": None,
            "recipients": [{"email": "x@example.com", "status": "sent"}],
        },
    )
    db.commit()

    rows = client.get(f"/tournaments/{td_tournament.id}/join-codes/emails/").json()

    assert [(r["email"], r["join_code"]) for r in rows] == [
        ("b@example.com", "HIST0002"),
        ("c@example.com", "HIST0002"),
        ("a@example.com", "HIST0001"),
    ]
    assert rows[0]["join_code_id"] == second.id
    assert rows[0]["label"] is None
    assert rows[0]["status"] == "sent"
    assert rows[0]["sender"]["user_id"] == td_user.id
    assert rows[0]["invite_creator"]["user_id"] == td_user.id


def test_list_invite_emails_volunteer_forbidden(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")

    assert client.get(f"/tournaments/{other_tournament.id}/join-codes/emails/").status_code == 403
