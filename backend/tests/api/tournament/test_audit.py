"""Tests for /tournaments/{tournament_id}/audit-log/
(app/api/routes/tournament/audit.py).

Entries are written directly via log_action rather than by driving the routes
that emit them — these tests are about the read side (gating, keyset paging,
filtering, actor/role hydration), so building the log explicitly keeps each
case's fixture data visible instead of implied by a chain of other endpoints.
"""
from datetime import datetime, timedelta, timezone

from app.core.tournament.audit import (
    JOIN_CODE_CREATED, ROLE_CREATED, ROLE_DELETED, ROLE_UPDATED, log_action,
)
from app.models.models import AuditLogEntry, TournamentRole
from tests.conftest import grant_role, login


def _log(db, tournament_id, actor_id, action=ROLE_CREATED, **kwargs):
    entry = log_action(db, tournament_id, actor_id, action, **kwargs)
    db.commit()
    db.refresh(entry)
    return entry


def _role_id(db, tournament_id, label):
    return (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament_id, TournamentRole.label == label)
        .one()
        .id
    )


# ---------------------------------------------------------------------------
# GET /audit-log/ — permission gating (manage_tournament)
# ---------------------------------------------------------------------------

def test_list_audit_log_td_can_access(client, td_user, td_tournament, db):
    _log(db, td_tournament.id, td_user.id)
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/audit-log/")
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1


def test_list_audit_log_admin_can_access(client, admin_user, td_tournament, db, td_user):
    _log(db, td_tournament.id, td_user.id)
    login(client, "admin@test.com", "adminpass")
    assert client.get(f"/tournaments/{td_tournament.id}/audit-log/").status_code == 200


def test_list_audit_log_volunteer_member_forbidden(client, td_user, other_tournament, db):
    """manage_members isn't enough — the log is manage_tournament only."""
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/audit-log/").status_code == 403


def test_list_audit_log_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{other_tournament.id}/audit-log/").status_code == 404


def test_list_audit_log_unauthenticated(client, td_tournament):
    assert client.get(f"/tournaments/{td_tournament.id}/audit-log/").status_code == 401


# ---------------------------------------------------------------------------
# Ordering + tournament scoping
# ---------------------------------------------------------------------------

def test_list_audit_log_newest_first(client, td_user, td_tournament, db):
    first = _log(db, td_tournament.id, td_user.id, action=ROLE_CREATED)
    second = _log(db, td_tournament.id, td_user.id, action=ROLE_UPDATED)
    third = _log(db, td_tournament.id, td_user.id, action=ROLE_DELETED)

    login(client, "td@test.com", "tdpass")
    items = client.get(f"/tournaments/{td_tournament.id}/audit-log/").json()["items"]
    assert [i["id"] for i in items] == [third.id, second.id, first.id]


def test_list_audit_log_excludes_other_tournaments(
    client, td_user, td_tournament, other_tournament, other_user, db
):
    mine = _log(db, td_tournament.id, td_user.id)
    _log(db, other_tournament.id, other_user.id)

    login(client, "td@test.com", "tdpass")
    items = client.get(f"/tournaments/{td_tournament.id}/audit-log/").json()["items"]
    assert [i["id"] for i in items] == [mine.id]


def test_list_audit_log_empty(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/audit-log/").json()
    assert data["items"] == []
    assert data["next_before_id"] is None


# ---------------------------------------------------------------------------
# Keyset pagination
# ---------------------------------------------------------------------------

def test_list_audit_log_limit_and_next_before_id(client, td_user, td_tournament, db):
    entries = [_log(db, td_tournament.id, td_user.id) for _ in range(5)]
    login(client, "td@test.com", "tdpass")

    data = client.get(f"/tournaments/{td_tournament.id}/audit-log/?limit=2").json()
    assert [i["id"] for i in data["items"]] == [entries[4].id, entries[3].id]
    # A full page hands back its last id as the cursor for the next fetch.
    assert data["next_before_id"] == entries[3].id


def test_list_audit_log_before_id_fetches_next_page(client, td_user, td_tournament, db):
    entries = [_log(db, td_tournament.id, td_user.id) for _ in range(5)]
    login(client, "td@test.com", "tdpass")

    page2 = client.get(
        f"/tournaments/{td_tournament.id}/audit-log/?limit=2&before_id={entries[3].id}"
    ).json()
    assert [i["id"] for i in page2["items"]] == [entries[2].id, entries[1].id]


def test_list_audit_log_paging_walks_every_entry_once(client, td_user, td_tournament, db):
    entries = [_log(db, td_tournament.id, td_user.id) for _ in range(5)]
    login(client, "td@test.com", "tdpass")

    seen, cursor = [], None
    while True:
        url = f"/tournaments/{td_tournament.id}/audit-log/?limit=2"
        if cursor is not None:
            url += f"&before_id={cursor}"
        data = client.get(url).json()
        seen.extend(i["id"] for i in data["items"])
        cursor = data["next_before_id"]
        if cursor is None:
            break

    assert seen == [e.id for e in reversed(entries)]


def test_list_audit_log_partial_page_has_no_cursor(client, td_user, td_tournament, db):
    """next_before_id is None when the page came back short of `limit` — that's
    the signal there's nothing left, so a short page must not hand back a cursor."""
    [_log(db, td_tournament.id, td_user.id) for _ in range(3)]
    login(client, "td@test.com", "tdpass")

    data = client.get(f"/tournaments/{td_tournament.id}/audit-log/?limit=10").json()
    assert len(data["items"]) == 3
    assert data["next_before_id"] is None


def test_list_audit_log_limit_out_of_bounds_rejected(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{td_tournament.id}/audit-log/?limit=0").status_code == 422
    assert client.get(f"/tournaments/{td_tournament.id}/audit-log/?limit=201").status_code == 422


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

def test_list_audit_log_filter_by_action(client, td_user, td_tournament, db):
    _log(db, td_tournament.id, td_user.id, action=ROLE_CREATED)
    target = _log(db, td_tournament.id, td_user.id, action=JOIN_CODE_CREATED)

    login(client, "td@test.com", "tdpass")
    items = client.get(
        f"/tournaments/{td_tournament.id}/audit-log/?action={JOIN_CODE_CREATED}"
    ).json()["items"]
    assert [i["id"] for i in items] == [target.id]


def test_list_audit_log_filter_by_target_type(client, td_user, td_tournament, db):
    _log(db, td_tournament.id, td_user.id, target_type="role", target_id=1)
    target = _log(db, td_tournament.id, td_user.id, target_type="join_code", target_id=1)

    login(client, "td@test.com", "tdpass")
    items = client.get(
        f"/tournaments/{td_tournament.id}/audit-log/?target_type=join_code"
    ).json()["items"]
    assert [i["id"] for i in items] == [target.id]


def test_list_audit_log_filter_by_target_id(client, td_user, td_tournament, db):
    _log(db, td_tournament.id, td_user.id, target_type="join_code", target_id=11)
    target = _log(db, td_tournament.id, td_user.id, target_type="join_code", target_id=22)

    login(client, "td@test.com", "tdpass")
    items = client.get(
        f"/tournaments/{td_tournament.id}/audit-log/?target_id=22"
    ).json()["items"]
    assert [i["id"] for i in items] == [target.id]


def test_list_audit_log_filter_by_actor_id(client, td_user, td_tournament, other_user, db):
    grant_role(db, td_tournament, other_user, "Volunteer")
    _log(db, td_tournament.id, td_user.id)
    target = _log(db, td_tournament.id, other_user.id)

    login(client, "td@test.com", "tdpass")
    items = client.get(
        f"/tournaments/{td_tournament.id}/audit-log/?actor_id={other_user.id}"
    ).json()["items"]
    assert [i["id"] for i in items] == [target.id]


def test_list_audit_log_filters_are_anded(client, td_user, td_tournament, other_user, db):
    grant_role(db, td_tournament, other_user, "Volunteer")
    # Matches action only, actor only, then both.
    _log(db, td_tournament.id, td_user.id, action=JOIN_CODE_CREATED)
    _log(db, td_tournament.id, other_user.id, action=ROLE_CREATED)
    both = _log(db, td_tournament.id, other_user.id, action=JOIN_CODE_CREATED)

    login(client, "td@test.com", "tdpass")
    items = client.get(
        f"/tournaments/{td_tournament.id}/audit-log/"
        f"?action={JOIN_CODE_CREATED}&actor_id={other_user.id}"
    ).json()["items"]
    assert [i["id"] for i in items] == [both.id]


def test_list_audit_log_filter_since_and_until(client, td_user, td_tournament, db):
    old = _log(db, td_tournament.id, td_user.id)
    recent = _log(db, td_tournament.id, td_user.id)

    # Backdate the first entry so the two straddle the cutoff.
    old.created_at = datetime.now(timezone.utc) - timedelta(days=10)
    db.commit()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    # params= rather than an f-string — the tz offset's "+" would otherwise
    # decode as a space and 422 the request.
    login(client, "td@test.com", "tdpass")
    url = f"/tournaments/{td_tournament.id}/audit-log/"

    since = client.get(url, params={"since": cutoff}).json()["items"]
    assert [i["id"] for i in since] == [recent.id]

    until = client.get(url, params={"until": cutoff}).json()["items"]
    assert [i["id"] for i in until] == [old.id]


# ---------------------------------------------------------------------------
# Actor + role hydration
# ---------------------------------------------------------------------------

def test_list_audit_log_actor_resolves_to_membership(client, td_user, td_tournament, db):
    _log(db, td_tournament.id, td_user.id)
    login(client, "td@test.com", "tdpass")

    actor = client.get(f"/tournaments/{td_tournament.id}/audit-log/").json()["items"][0]["actor"]
    assert actor["user_id"] == td_user.id
    assert actor["membership_id"] is not None
    assert [r["label"] for r in actor["roles"]] == ["Tournament Director"]


def test_list_audit_log_actor_carries_no_contact_details(client, td_user, td_tournament, db):
    """A reference credits an action; it is not a directory entry. The whole
    roster row used to ride along here — email, phone, age flags, lunch."""
    _log(db, td_tournament.id, td_user.id)
    login(client, "td@test.com", "tdpass")

    actor = client.get(f"/tournaments/{td_tournament.id}/audit-log/").json()["items"][0]["actor"]
    assert set(actor) == {"user_id", "membership_id", "first_name", "last_name", "roles"}


def test_list_audit_log_actor_role_carries_no_permissions(client, td_user, td_tournament, db):
    """PersonRoleRead, not RoleRead — rank and permissions are the
    authorization model, not part of naming who acted."""
    _log(db, td_tournament.id, td_user.id)
    login(client, "td@test.com", "tdpass")

    role = client.get(f"/tournaments/{td_tournament.id}/audit-log/").json()["items"][0]["actor"]["roles"][0]
    assert set(role) == {"id", "label"}


def test_list_audit_log_actor_falls_back_to_user_without_membership(
    client, td_user, td_tournament, admin_user, db
):
    """A site admin can act on a tournament without ever joining it — the log
    still has to name them, so roles come back null rather than empty."""
    _log(db, td_tournament.id, admin_user.id)
    login(client, "td@test.com", "tdpass")

    actor = client.get(f"/tournaments/{td_tournament.id}/audit-log/").json()["items"][0]["actor"]
    assert actor["user_id"] == admin_user.id
    assert actor["membership_id"] is None
    assert actor["roles"] is None


def test_list_audit_log_hydrates_role_target(client, td_user, td_tournament, db):
    role_id = _role_id(db, td_tournament.id, "Volunteer")
    _log(db, td_tournament.id, td_user.id, action=ROLE_UPDATED, target_type="role", target_id=role_id)

    login(client, "td@test.com", "tdpass")
    entry = client.get(f"/tournaments/{td_tournament.id}/audit-log/").json()["items"][0]
    assert entry["role"]["id"] == role_id
    assert entry["role"]["label"] == "Volunteer"


def test_list_audit_log_role_is_none_for_deleted_role(client, td_user, td_tournament, db):
    """role_deleted entries outlive the role they point at — the entry still
    renders, with role left null rather than 500ing on the missing row."""
    role_id = _role_id(db, td_tournament.id, "Volunteer")
    _log(db, td_tournament.id, td_user.id, action=ROLE_DELETED, target_type="role", target_id=role_id)
    db.query(TournamentRole).filter(TournamentRole.id == role_id).delete()
    db.commit()

    login(client, "td@test.com", "tdpass")
    entry = client.get(f"/tournaments/{td_tournament.id}/audit-log/").json()["items"][0]
    assert entry["role"] is None


def test_list_audit_log_role_is_none_for_non_role_target(client, td_user, td_tournament, db):
    """target_id is only a role id when target_type says so — a join_code with
    the same numeric id must not pick up a role."""
    role_id = _role_id(db, td_tournament.id, "Volunteer")
    _log(
        db, td_tournament.id, td_user.id,
        action=JOIN_CODE_CREATED, target_type="join_code", target_id=role_id,
    )

    login(client, "td@test.com", "tdpass")
    entry = client.get(f"/tournaments/{td_tournament.id}/audit-log/").json()["items"][0]
    assert entry["role"] is None


def test_list_audit_log_returns_extra_data(client, td_user, td_tournament, db):
    _log(db, td_tournament.id, td_user.id, extra_data={"old": "a", "new": "b"})
    login(client, "td@test.com", "tdpass")

    entry = client.get(f"/tournaments/{td_tournament.id}/audit-log/").json()["items"][0]
    assert entry["extra_data"] == {"old": "a", "new": "b"}


# ---------------------------------------------------------------------------
# GET /audit-log/actors/
# ---------------------------------------------------------------------------

def test_list_audit_log_actors_counts_per_actor(client, td_user, td_tournament, other_user, db):
    grant_role(db, td_tournament, other_user, "Volunteer")
    _log(db, td_tournament.id, td_user.id)
    _log(db, td_tournament.id, other_user.id)
    _log(db, td_tournament.id, other_user.id)

    login(client, "td@test.com", "tdpass")
    rows = client.get(f"/tournaments/{td_tournament.id}/audit-log/actors/").json()

    counts = {row["actor"]["user_id"]: row["count"] for row in rows}
    assert counts == {td_user.id: 1, other_user.id: 2}


def test_list_audit_log_actors_most_active_first(client, td_user, td_tournament, other_user, db):
    grant_role(db, td_tournament, other_user, "Volunteer")
    _log(db, td_tournament.id, td_user.id)
    for _ in range(3):
        _log(db, td_tournament.id, other_user.id)

    login(client, "td@test.com", "tdpass")
    rows = client.get(f"/tournaments/{td_tournament.id}/audit-log/actors/").json()
    assert [row["actor"]["user_id"] for row in rows] == [other_user.id, td_user.id]


def test_list_audit_log_actors_excludes_other_tournaments(
    client, td_user, td_tournament, other_tournament, other_user, db
):
    _log(db, td_tournament.id, td_user.id)
    _log(db, other_tournament.id, other_user.id)

    login(client, "td@test.com", "tdpass")
    rows = client.get(f"/tournaments/{td_tournament.id}/audit-log/actors/").json()
    assert [row["actor"]["user_id"] for row in rows] == [td_user.id]


def test_list_audit_log_actors_empty(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(f"/tournaments/{td_tournament.id}/audit-log/actors/").json() == []


def test_list_audit_log_actors_volunteer_member_forbidden(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/audit-log/actors/"
    ).status_code == 403


def test_list_audit_log_actors_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/audit-log/actors/"
    ).status_code == 404
