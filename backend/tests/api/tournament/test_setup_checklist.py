"""Tests for GET /tournaments/{tournament_id}/setup-checklist/
(app/api/routes/tournament/setup_checklist.py). Status is computed live off
other tables, not stored — see app/core/tournament/setup_checklist.py."""
from tests.conftest import TOURNAMENT_REQUIRED_FIELDS, grant_role, login

# start_date/end_date/state/level/division are all required on TournamentCreate
# now, so the checklist no longer tracks "dates"/"location" — they're
# unconditionally set on every tournament from creation onward.
REQUIRED_FIELDS = TOURNAMENT_REQUIRED_FIELDS


def _checklist_by_key(response_json):
    return {item["item_key"]: item["status"] for item in response_json["items"]}


def test_checklist_fresh_tournament_only_roles_and_invite_pending(client, td_user):
    login(client, "td@test.com", "tdpass")
    tournament_id = client.post(
        "/tournaments/", json={"name": "Fresh", "location": "Test Location", **REQUIRED_FIELDS}
    ).json()["id"]

    response = client.get(f"/tournaments/{tournament_id}/setup-checklist/")
    assert response.status_code == 200
    data = response.json()
    statuses = _checklist_by_key(data)

    assert "dates" not in statuses
    assert "location" not in statuses
    assert statuses["roles"] == "not_started"
    assert statuses["invite_staff"] == "not_started"
    for key in ("onboarding", "events", "shifts", "buildings"):
        assert statuses[key] == "not_started"

    assert data["completed_count"] == 0
    assert data["total_count"] == 6


def test_checklist_roles_complete_after_apply_template(client, td_user):
    login(client, "td@test.com", "tdpass")
    tournament_id = client.post(
        "/tournaments/", json={"name": "Rolled", "location": "Test Location", **REQUIRED_FIELDS}
    ).json()["id"]
    client.post(f"/tournaments/{tournament_id}/roles/apply-template/")

    statuses = _checklist_by_key(
        client.get(f"/tournaments/{tournament_id}/setup-checklist/").json()
    )
    assert statuses["roles"] == "complete"


def test_checklist_invite_staff_complete_after_invite(client, td_user, mock_send_email):
    login(client, "td@test.com", "tdpass")
    tournament_id = client.post(
        "/tournaments/", json={"name": "Invited", "location": "Test Location", **REQUIRED_FIELDS}
    ).json()["id"]
    join_code = client.post(f"/tournaments/{tournament_id}/join-codes/", json={}).json()
    client.post(
        f"/tournaments/{tournament_id}/staff-invites/",
        json={"join_code_id": join_code["id"], "emails": ["a@example.com"]},
    )

    statuses = _checklist_by_key(
        client.get(f"/tournaments/{tournament_id}/setup-checklist/").json()
    )
    assert statuses["invite_staff"] == "complete"


def test_checklist_requires_manage_tournament(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/setup-checklist/"
    ).status_code == 403


def test_checklist_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.get(
        f"/tournaments/{other_tournament.id}/setup-checklist/"
    ).status_code == 404


def test_checklist_unauthenticated(client, td_tournament):
    assert client.get(
        f"/tournaments/{td_tournament.id}/setup-checklist/"
    ).status_code == 401
