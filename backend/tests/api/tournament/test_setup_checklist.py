"""Tests for GET /tournaments/{tournament_id}/setup-checklist/
(app/api/routes/tournament/setup_checklist.py). Status is computed live off
other tables, not stored — see app/core/tournament/setup_checklist.py."""
from app.models.models import Form, TournamentForm
from tests.conftest import TOURNAMENT_REQUIRED_FIELDS, grant_role, login

# A tournament is created with at least one primary track carrying its dates,
# venue and divisions, so the checklist no longer tracks "dates"/"location" —
# they're unconditionally set on every tournament from creation onward.
REQUIRED_FIELDS = TOURNAMENT_REQUIRED_FIELDS


def _checklist_by_key(response_json):
    return {item["item_key"]: item["status"] for item in response_json["items"]}


def _statuses(client, tournament_id):
    return _checklist_by_key(
        client.get(f"/tournaments/{tournament_id}/setup-checklist/").json()
    )


def _new_tournament(client, name="Fresh"):
    return client.post("/tournaments/", json={"name": name, **REQUIRED_FIELDS}).json()["id"]


def _add_form(db, user, tournament_id, *, status="draft", is_onboarding=None):
    """A tournament-owned form, optionally linked as a published onboarding step."""
    form = Form(
        owner_type="tournament",
        tournament_id=tournament_id,
        name="Volunteer Interest",
        status=status,
        created_by=user.id,
    )
    db.add(form)
    db.flush()
    if is_onboarding is not None:
        db.add(TournamentForm(
            form_id=form.id, tournament_id=tournament_id,
            is_onboarding=is_onboarding, order=1,
        ))
    db.commit()
    return form


def test_checklist_fresh_tournament_has_everything_pending(client, td_user):
    login(client, "td@test.com", "tdpass")
    tournament_id = client.post(
        "/tournaments/", json={"name": "Fresh", **REQUIRED_FIELDS}
    ).json()["id"]

    response = client.get(f"/tournaments/{tournament_id}/setup-checklist/")
    assert response.status_code == 200
    data = response.json()
    statuses = _checklist_by_key(data)

    assert "dates" not in statuses
    assert "location" not in statuses
    # Dropped once buildings stopped being a planned feature.
    assert "buildings" not in statuses
    for key in ("roles", "invite_staff", "events", "shifts", "first_form", "onboarding"):
        assert statuses[key] == "not_started"

    assert data["completed_count"] == 0
    assert data["total_count"] == 6


def test_checklist_roles_complete_after_apply_template(client, td_user):
    login(client, "td@test.com", "tdpass")
    tournament_id = client.post(
        "/tournaments/", json={"name": "Rolled", **REQUIRED_FIELDS}
    ).json()["id"]
    client.post(f"/tournaments/{tournament_id}/roles/apply-template/")

    statuses = _checklist_by_key(
        client.get(f"/tournaments/{tournament_id}/setup-checklist/").json()
    )
    assert statuses["roles"] == "complete"


def test_checklist_invite_staff_complete_after_invite(client, td_user, mock_send_email):
    login(client, "td@test.com", "tdpass")
    tournament_id = client.post(
        "/tournaments/", json={"name": "Invited", **REQUIRED_FIELDS}
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


# ---------------------------------------------------------------------------
# Items that used to be hardcoded not_started and now read real tables
# ---------------------------------------------------------------------------

def test_checklist_events_complete_after_creating_one(client, td_user):
    login(client, "td@test.com", "tdpass")
    tournament_id = _new_tournament(client, "Evented")
    assert _statuses(client, tournament_id)["events"] == "not_started"

    client.post(f"/tournaments/{tournament_id}/events/", json={
        "tournament_id": tournament_id, "name": "Boomilever", "division": "C",
    })
    assert _statuses(client, tournament_id)["events"] == "complete"


def test_checklist_shifts_complete_after_creating_one(client, td_user):
    login(client, "td@test.com", "tdpass")
    tournament_id = _new_tournament(client, "Shifted")
    assert _statuses(client, tournament_id)["shifts"] == "not_started"

    tracks = client.get(f"/tournaments/{tournament_id}/tracks/?public=true").json()
    primary = next(t for t in tracks if t["is_primary"])
    client.post(f"/tournaments/{tournament_id}/shifts/", json={
        "track_id": primary["id"], "label": "Morning",
        "start": f"{primary['start_date']}T08:00:00Z",
        "end": f"{primary['start_date']}T12:00:00Z",
    })
    assert _statuses(client, tournament_id)["shifts"] == "complete"


def test_checklist_first_form_complete_for_a_draft(client, db, td_user):
    """Any form counts here — the step is "you've built something", not
    "you've shipped it". Onboarding is the one that demands published."""
    login(client, "td@test.com", "tdpass")
    tournament_id = _new_tournament(client, "Drafty")
    _add_form(db, td_user, tournament_id, status="draft")

    statuses = _statuses(client, tournament_id)
    assert statuses["first_form"] == "complete"
    assert statuses["onboarding"] == "not_started"


def test_checklist_onboarding_needs_published_and_flagged(client, db, td_user):
    login(client, "td@test.com", "tdpass")
    tournament_id = _new_tournament(client, "Onboarding")

    # Published but not an onboarding step.
    _add_form(db, td_user, tournament_id, status="published", is_onboarding=False)
    assert _statuses(client, tournament_id)["onboarding"] == "not_started"

    # Flagged as onboarding but still a draft — collects nobody.
    _add_form(db, td_user, tournament_id, status="draft", is_onboarding=True)
    assert _statuses(client, tournament_id)["onboarding"] == "not_started"

    _add_form(db, td_user, tournament_id, status="published", is_onboarding=True)
    assert _statuses(client, tournament_id)["onboarding"] == "complete"


def test_checklist_counts_every_completed_item(client, db, td_user):
    login(client, "td@test.com", "tdpass")
    tournament_id = _new_tournament(client, "Counted")
    client.post(f"/tournaments/{tournament_id}/roles/apply-template/")
    _add_form(db, td_user, tournament_id, status="published", is_onboarding=True)

    data = client.get(f"/tournaments/{tournament_id}/setup-checklist/").json()
    assert data["completed_count"] == 3  # roles, first_form, onboarding
    assert data["total_count"] == 6
