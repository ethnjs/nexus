"""Tests for /tournaments/{tournament_id}/memberships endpoints."""
from datetime import date, timedelta
import pytest
from fastapi.testclient import TestClient
from app.core.tournament.permissions import MANAGE_MEMBERS
from app.models.models import (
    Form, FormAnswer, FormField, FormResponse,
    TournamentMembership, TournamentMembershipRole, TournamentRole,
)
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
    defaults = {"user_id": user_id, "tournament_id": tournament_id, "source": "manual"}
    defaults.update(overrides)
    membership = TournamentMembership(**defaults)
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return membership


def _make_form(db, user, tournament_id, **overrides):
    defaults = dict(
        owner_type="tournament", tournament_id=tournament_id, chapter_id=None,
        name="Test form", title="Test form", status="published", created_by=user.id,
    )
    defaults.update(overrides)
    form = Form(**defaults)
    db.add(form)
    db.flush()
    return form


def _make_field(db, form, *, order=1, field_key="favorite_color", question_type="single_select_dropdown", **overrides):
    defaults = dict(
        form_id=form.id, order=order, label="Favorite color", question_type=question_type,
        field_key=field_key, config={"required": False, "options": []},
    )
    defaults.update(overrides)
    field = FormField(**defaults)
    db.add(field)
    db.flush()
    return field


def _make_answer(db, user_id, form, field, value):
    response = FormResponse(form_id=form.id, user_id=user_id)
    db.add(response)
    db.flush()
    answer = FormAnswer(response_id=response.id, field_id=field.id, value=value)
    db.add(answer)
    db.commit()
    return answer


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


def test_list_memberships_excludes_declined_by_default(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "td@test.com", "tdpass")
    ids = [m["id"] for m in client.get(f"/tournaments/{td_tournament.id}/memberships/").json()]
    assert membership.id not in ids


def test_list_memberships_includes_declined_when_opted_in(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/?include_declined=true")
    row = next(m for m in response.json() if m["id"] == membership.id)
    assert row["age_disclosure"] == "declined"


def test_search_memberships_excludes_declined(client, td_user, td_tournament, other_user, db):
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "td@test.com", "tdpass")
    ids = [m["id"] for m in client.get(f"/tournaments/{td_tournament.id}/memberships/search/").json()]
    assert membership.id not in ids


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


def test_search_memberships_max_rank_excludes_equal_and_higher_authority(
    client, td_user, td_tournament, db
):
    """max_rank powers the "who can this actor act on" pickers. Rank is
    authority-ascending-numeric (lower number = more authority), so a member is
    kept only if their strongest role is strictly *less* authoritative than
    max_rank — an equal rank ties, and a tie must not be actionable."""
    from app.models.models import User as UserModel

    td_role = db.query(TournamentRole).filter(
        TournamentRole.tournament_id == td_tournament.id,
        TournamentRole.label == "Tournament Director",
    ).one()

    peer = db.query(UserModel).filter(
        UserModel.id == _make_user(db, "peer@example.com")["id"]
    ).first()
    _make_low_rank_role(db, td_tournament, "Peer Staff", rank=50)
    grant_role(db, td_tournament, peer, "Peer Staff")

    junior = db.query(UserModel).filter(
        UserModel.id == _make_user(db, "junior@example.com")["id"]
    ).first()
    _make_low_rank_role(db, td_tournament, "Junior Staff", rank=90)
    grant_role(db, td_tournament, junior, "Junior Staff")

    login(client, "td@test.com", "tdpass")
    response = client.get(
        f"/tournaments/{td_tournament.id}/memberships/search/?max_rank=50"
    )
    assert response.status_code == 200
    emails = [m["user"]["email"] for m in response.json()]

    assert "junior@example.com" in emails       # rank 90, less authority — actionable
    assert "peer@example.com" not in emails     # rank 50, exact tie — excluded
    assert "td@test.com" not in emails          # rank 10, outranks — excluded
    assert td_role.rank < 50


def test_search_memberships_max_rank_keeps_roleless_members(
    client, td_user, td_tournament, db
):
    """A member with no roles has no authority at all, so they always pass the
    max_rank filter — the NOT IN subquery only matches members that hold roles."""
    roleless = _make_user(db, "roleless@example.com")
    _make_membership(db, td_tournament.id, roleless["id"])

    login(client, "td@test.com", "tdpass")
    response = client.get(
        f"/tournaments/{td_tournament.id}/memberships/search/?max_rank=50"
    )
    assert response.status_code == 200
    assert "roleless@example.com" in [m["user"]["email"] for m in response.json()]


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


def test_get_membership_availability_and_lunch_empty(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/{m.id}/")
    assert response.status_code == 200
    data = response.json()
    assert data["availability"] == []
    assert data["lunch"] == []


def test_get_membership_availability_and_lunch_populated(client, td_user, td_tournament, db):
    from datetime import datetime
    from app.models.models import (
        TournamentMembershipAvailability, TournamentMembershipLunch, TournamentShift,
    )

    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])

    shift = TournamentShift(
        tournament_id=td_tournament.id, label="Morning",
        start=datetime(2026, 5, 21, 8, 0), end=datetime(2026, 5, 21, 12, 0),
    )
    db.add(shift)
    db.flush()
    db.add(TournamentMembershipAvailability(membership_id=m.id, tournament_shift_id=shift.id))
    db.add(TournamentMembershipLunch(
        membership_id=m.id, date=date(2026, 5, 21), category="entree", value="pizza", label="Pizza",
    ))
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/{m.id}/")
    assert response.status_code == 200
    data = response.json()

    assert len(data["availability"]) == 1
    assert data["availability"][0]["shift_id"] == shift.id
    assert data["availability"][0]["label"] == "Morning"

    assert len(data["lunch"]) == 1
    assert data["lunch"][0] == {"date": "2026-05-21", "category": "entree", "label": "Pizza"}


def test_get_membership_custom_responses_empty(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/{m.id}/")
    assert response.status_code == 200
    assert response.json()["custom_responses"] == []


def test_get_membership_custom_responses_populated(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    form = _make_form(db, td_user, td_tournament.id, title="Volunteer interest")
    field = _make_field(db, form, field_key="favorite_color", label="Favorite color")
    _make_answer(db, u["id"], form, field, "opt_1")

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/{m.id}/")
    assert response.status_code == 200
    custom = response.json()["custom_responses"]
    assert custom == [{
        "form_title": "Volunteer interest", "field_label": "Favorite color",
        "question_type": "single_select_dropdown", "value": "opt_1",
    }]


def test_get_membership_custom_responses_excludes_reserved_field_keys(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    form = _make_form(db, td_user, td_tournament.id)
    reserved = _make_field(
        db, form, field_key="track_status_writer", question_type="single_select_radio",
    )
    _make_answer(db, u["id"], form, reserved, "confirmed")

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/{m.id}/")
    assert response.status_code == 200
    assert response.json()["custom_responses"] == []


def test_get_membership_custom_responses_excludes_unpublished_forms(client, td_user, td_tournament, db):
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    draft_form = _make_form(db, td_user, td_tournament.id, status="draft")
    field = _make_field(db, draft_form)
    _make_answer(db, u["id"], draft_form, field, "opt_1")

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/{m.id}/")
    assert response.status_code == 200
    assert response.json()["custom_responses"] == []


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


def test_get_my_membership_includes_enrichment(client, td_tournament, db):
    """/me/ carries the same enrichment MembershipFullResponse gives
    manage_members about someone else — a plain member with no special
    permission still reads their own availability/lunch/custom answers/age
    flags."""
    from datetime import datetime
    from app.core.auth import hash_password
    from app.models.models import (
        TournamentMembershipAvailability, TournamentMembershipLunch, TournamentShift, User as UserModel,
    )

    u = _make_user(db, "volunteer2@example.com")
    user = db.query(UserModel).filter(UserModel.id == u["id"]).first()
    user.hashed_password = hash_password("volpass")
    db.commit()
    membership = grant_role(db, td_tournament, user, "Volunteer")

    shift = TournamentShift(
        tournament_id=td_tournament.id, label="Morning",
        start=datetime(2026, 5, 21, 8, 0), end=datetime(2026, 5, 21, 12, 0),
    )
    db.add(shift)
    db.flush()
    db.add(TournamentMembershipAvailability(membership_id=membership.id, tournament_shift_id=shift.id))
    db.add(TournamentMembershipLunch(
        membership_id=membership.id, date=date(2026, 5, 21), category="entree", value="pizza", label="Pizza",
    ))
    db.commit()

    login(client, "volunteer2@example.com", "volpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/me/")
    assert response.status_code == 200
    data = response.json()
    # td_tournament doesn't collect either flag — omitted, not null (see the
    # gating tests below this file's age-flags section).
    assert "is_over_18" not in data
    assert "is_over_21" not in data
    assert len(data["availability"]) == 1
    assert data["availability"][0]["label"] == "Morning"
    assert len(data["lunch"]) == 1
    assert data["lunch"][0]["label"] == "Pizza"
    assert data["custom_responses"] == []


def test_get_my_membership_needs_age_consent_when_collected_and_unanswered(client, td_tournament, other_user, db):
    td_tournament.collect_is_over_18 = True
    db.commit()
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "other@test.com", "otherpass")
    data = client.get(f"/tournaments/{td_tournament.id}/memberships/me/").json()
    assert data["needs_age_consent"] is True


def test_get_my_membership_needs_age_consent_false_once_answered(client, td_tournament, other_user, db):
    td_tournament.collect_is_over_18 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "other@test.com", "otherpass")
    data = client.get(f"/tournaments/{td_tournament.id}/memberships/me/").json()
    assert data["needs_age_consent"] is False


def test_get_my_membership_needs_age_consent_false_when_not_collected(client, td_tournament, other_user, db):
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "other@test.com", "otherpass")
    data = client.get(f"/tournaments/{td_tournament.id}/memberships/me/").json()
    assert data["needs_age_consent"] is False


def test_get_my_membership_admin_without_membership(client, admin_user, td_tournament):
    """A site admin who never joined the tournament still gets in via
    require_membership()'s admin bypass — membership_id/roles are
    null/empty but permissions come back as the full admin set."""
    login(client, "admin@test.com", "adminpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/me/")
    assert response.status_code == 200
    data = response.json()
    assert data["membership_id"] is None
    assert data["is_owner"] is False
    assert data["roles"] == []
    assert len(data["permissions"]) > 0


def test_get_my_membership_no_membership_returns_null_id(client, td_user, other_tournament):
    """No membership at all in the tournament — 200 with membership_id=None,
    same shape as the site-admin-without-a-row case. This route deliberately
    doesn't gate on require_membership() (see 2.4d): a declined member must
    still be able to check their own status here, and there's no way to
    special-case "declined" from "never joined" without also opening the
    door to "never joined"."""
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{other_tournament.id}/memberships/me/")
    assert response.status_code == 200
    assert response.json()["membership_id"] is None


def test_get_my_membership_still_reachable_when_declined(client, td_tournament, other_user, db):
    """The escape hatch 2.4d relies on: a declined member can still see
    their own row (not just membership_id=None) to know they're declined
    and re-consent via POST .../me/age-disclosure/."""
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "other@test.com", "otherpass")
    response = client.get(f"/tournaments/{td_tournament.id}/memberships/me/")
    assert response.status_code == 200
    assert response.json()["membership_id"] == membership.id


def test_get_my_membership_not_found_tournament(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.get("/tournaments/9999/memberships/me/").status_code == 404


# ---------------------------------------------------------------------------
# Self-service update — PATCH .../me/
# ---------------------------------------------------------------------------

def test_update_my_membership_ignores_all_fields(client, td_tournament, db):
    """MembershipMeUpdate has no fields left — onboarding data (role/event
    preference, availability, lunch) now comes through the native form
    response flow, not this endpoint. Sending any of it is a no-op, not an
    error."""
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
        json={"notes": "should not be saved", "status": "confirmed", "lunch_order": "Veggie Wrap"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["notes"] is None


def test_update_my_membership_not_found(client, td_tournament, td_user):
    """td_user has no membership in a tournament they didn't join — 404, not 403."""
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id + 9999}/memberships/me/",
        json={},
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
    m1 = _make_membership(db, td_tournament.id, u1["id"])
    _make_membership(db, td_tournament.id, u2["id"])

    login(client, "vol-a@example.com", "volpassA")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/me/",
        json={},
    )
    assert response.status_code == 200
    assert response.json()["id"] == m1.id


# ---------------------------------------------------------------------------
# POST .../memberships/me/age-disclosure/ — self-service consent/decline
# ---------------------------------------------------------------------------

def test_age_disclosure_consent_sets_status_and_timestamp(client, td_tournament, other_user, db):
    td_tournament.collect_is_over_18 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "other@test.com", "otherpass")

    response = client.post(
        f"/tournaments/{td_tournament.id}/memberships/me/age-disclosure/", json={"consent": True},
    )
    assert response.status_code == 200
    assert response.json()["needs_age_consent"] is False

    db.refresh(membership)
    assert membership.age_disclosure == "consented"
    assert membership.age_disclosure_at is not None


def test_age_disclosure_decline_is_soft_and_keeps_data(client, td_tournament, other_user, db):
    """Declining sets the status column only — availability, lunch, track
    statuses, and event preferences all survive."""
    from datetime import datetime
    from app.models.models import (
        TournamentMembershipAvailability, TournamentMembershipLunch, TournamentShift,
    )

    td_tournament.collect_is_over_21 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")

    shift = TournamentShift(
        tournament_id=td_tournament.id, label="Morning",
        start=datetime(2026, 5, 21, 8, 0), end=datetime(2026, 5, 21, 12, 0),
    )
    db.add(shift)
    db.flush()
    db.add(TournamentMembershipAvailability(membership_id=membership.id, tournament_shift_id=shift.id))
    db.add(TournamentMembershipLunch(
        membership_id=membership.id, date=date(2026, 5, 21), category="entree", value="pizza", label="Pizza",
    ))
    db.commit()

    login(client, "other@test.com", "otherpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/memberships/me/age-disclosure/", json={"consent": False},
    )
    assert response.status_code == 200

    db.refresh(membership)
    assert membership.age_disclosure == "declined"
    assert membership.age_disclosure_at is not None
    assert db.query(TournamentMembershipAvailability).filter_by(membership_id=membership.id).count() == 1
    assert db.query(TournamentMembershipLunch).filter_by(membership_id=membership.id).count() == 1


def test_age_disclosure_recanting_flips_back_to_consented(client, td_tournament, other_user, db):
    """Re-answering after a decline moves straight to consented — no rejoin."""
    td_tournament.collect_is_over_18 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()

    login(client, "other@test.com", "otherpass")
    response = client.post(
        f"/tournaments/{td_tournament.id}/memberships/me/age-disclosure/", json={"consent": True},
    )
    assert response.status_code == 200
    db.refresh(membership)
    assert membership.age_disclosure == "consented"


def test_age_disclosure_not_found_without_membership(client, td_tournament, td_user):
    login(client, "td@test.com", "tdpass")
    response = client.post(
        f"/tournaments/{td_tournament.id + 9999}/memberships/me/age-disclosure/", json={"consent": True},
    )
    assert response.status_code == 404


def test_age_disclosure_unauthenticated_forbidden(client, td_tournament):
    assert client.post(
        f"/tournaments/{td_tournament.id}/memberships/me/age-disclosure/", json={"consent": True},
    ).status_code == 401


# ---------------------------------------------------------------------------
# Coordinator update — PATCH .../{membership_id}/
# ---------------------------------------------------------------------------

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
    """lunch_order/role_preference/etc aren't in MembershipCoordinatorUpdate
    (or on the model at all anymore) — sending them is a no-op."""
    u = _make_user(db)
    m = _make_membership(db, td_tournament.id, u["id"])
    login(client, "td@test.com", "tdpass")
    response = client.patch(
        f"/tournaments/{td_tournament.id}/memberships/{m.id}/",
        json={"lunch_order": "Changed by staff"},
    )
    assert response.status_code == 200
    assert "lunch_order" not in response.json()


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


# ---------------------------------------------------------------------------
# is_over_18 / is_over_21 on the membership detail response
#
# Hybrid properties computed against the tournament's start_date, not stored
# columns. They regressed silently once: the property called .date() on
# start_date (a Date column, so already a datetime.date), and Pydantic's
# from_attributes swallowed the AttributeError and served the field default —
# so the age flags read null for everyone instead of erroring. Assert on
# concrete True/False here, never just "not a 500".
# ---------------------------------------------------------------------------

def _age_flags(client, db, tournament, user, dob):
    """Collection on + consent given by default, so these tests exercise the
    age arithmetic itself — the gating that hides the flags otherwise is
    covered separately below."""
    user.date_of_birth = dob
    tournament.collect_is_over_18 = True
    tournament.collect_is_over_21 = True
    db.commit()
    membership = grant_role(db, tournament, user, "Volunteer")
    membership.age_disclosure = "consented"
    db.commit()
    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{tournament.id}/memberships/{membership.id}/")
    assert response.status_code == 200, response.text
    return response.json()


def test_membership_age_flags_null_without_date_of_birth(client, td_user, td_tournament, other_user, db):
    data = _age_flags(client, db, td_tournament, other_user, None)
    assert data["is_over_18"] is None
    assert data["is_over_21"] is None


def test_membership_age_flags_adult_over_21(client, td_user, td_tournament, other_user, db):
    start = td_tournament.start_date
    dob = date(start.year - 30, start.month, start.day)
    data = _age_flags(client, db, td_tournament, other_user, dob)
    assert data["is_over_18"] is True
    assert data["is_over_21"] is True


def test_membership_age_flags_minor(client, td_user, td_tournament, other_user, db):
    start = td_tournament.start_date
    dob = date(start.year - 15, start.month, start.day)
    data = _age_flags(client, db, td_tournament, other_user, dob)
    assert data["is_over_18"] is False
    assert data["is_over_21"] is False


def test_membership_age_flags_between_18_and_21(client, td_user, td_tournament, other_user, db):
    """The two gates are independent — a 19-year-old clears one, not the other."""
    start = td_tournament.start_date
    dob = date(start.year - 19, start.month, start.day)
    data = _age_flags(client, db, td_tournament, other_user, dob)
    assert data["is_over_18"] is True
    assert data["is_over_21"] is False


def test_membership_age_flags_computed_against_start_date_not_today(
    client, td_user, td_tournament, other_user, db
):
    """Turning 18 the day after the tournament starts means not-18 for that
    tournament, even though they're 18 by the time anyone reads the roster."""
    start = td_tournament.start_date
    dob = date(start.year - 18, start.month, start.day) + timedelta(days=1)
    data = _age_flags(client, db, td_tournament, other_user, dob)
    assert data["is_over_18"] is False


# ---------------------------------------------------------------------------
# is_over_18 / is_over_21 gating — omitted entirely unless the tournament
# collects that specific flag AND the membership has consented. Never sent
# as null in the gated-off case, which would read as "under 18" to a
# careless frontend.
# ---------------------------------------------------------------------------

def test_age_flags_omitted_when_tournament_does_not_collect(client, td_user, td_tournament, other_user, db):
    other_user.date_of_birth = date(2000, 1, 1)
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "consented"
    db.commit()
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/memberships/{membership.id}/").json()
    assert "is_over_18" not in data
    assert "is_over_21" not in data


def test_age_flags_omitted_when_not_consented(client, td_user, td_tournament, other_user, db):
    other_user.date_of_birth = date(2000, 1, 1)
    td_tournament.collect_is_over_18 = True
    td_tournament.collect_is_over_21 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    # age_disclosure left null — never answered.
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/memberships/{membership.id}/").json()
    assert "is_over_18" not in data
    assert "is_over_21" not in data


def test_age_flags_omitted_when_declined(client, td_user, td_tournament, other_user, db):
    other_user.date_of_birth = date(2000, 1, 1)
    td_tournament.collect_is_over_18 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "declined"
    db.commit()
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/memberships/{membership.id}/").json()
    assert "is_over_18" not in data


def test_age_flags_gated_independently_per_flag(client, td_user, td_tournament, other_user, db):
    """Collecting only is_over_18 shows only is_over_18, even with consent
    covering both — collection is the other half of the gate."""
    other_user.date_of_birth = date(2000, 1, 1)
    td_tournament.collect_is_over_18 = True
    td_tournament.collect_is_over_21 = False
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "consented"
    db.commit()
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/memberships/{membership.id}/").json()
    assert "is_over_18" in data
    assert "is_over_21" not in data


def test_age_flags_shown_when_collected_and_consented(client, td_user, td_tournament, other_user, db):
    other_user.date_of_birth = date(2000, 1, 1)
    td_tournament.collect_is_over_18 = True
    td_tournament.collect_is_over_21 = True
    db.commit()
    membership = grant_role(db, td_tournament, other_user, "Volunteer")
    membership.age_disclosure = "consented"
    db.commit()
    login(client, "td@test.com", "tdpass")
    data = client.get(f"/tournaments/{td_tournament.id}/memberships/{membership.id}/").json()
    assert "is_over_18" in data
    assert "is_over_21" in data


def test_age_flags_gate_applies_to_my_membership_too(client, td_tournament, other_user, db):
    """The same gate applies on GET .../me/ — manage_members isn't required
    to read your own row, but consent still is."""
    other_user.date_of_birth = date(2000, 1, 1)
    td_tournament.collect_is_over_18 = True
    db.commit()
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "other@test.com", "otherpass")
    data = client.get(f"/tournaments/{td_tournament.id}/memberships/me/").json()
    assert "is_over_18" not in data


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/memberships/me/ — leave a tournament
# ---------------------------------------------------------------------------

def test_leave_tournament_member_can_leave(client, td_user, other_tournament, db):
    grant_role(db, other_tournament, td_user, "Volunteer")
    login(client, "td@test.com", "tdpass")

    assert client.delete(f"/tournaments/{other_tournament.id}/memberships/me/").status_code == 204
    assert (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == other_tournament.id,
            TournamentMembership.user_id == td_user.id,
        )
        .first()
        is None
    )


def test_leave_tournament_owner_must_transfer_first(client, td_user, td_tournament):
    """Letting the owner walk would strand the tournament with an owner_id
    pointing at a non-member."""
    login(client, "td@test.com", "tdpass")
    response = client.delete(f"/tournaments/{td_tournament.id}/memberships/me/")
    assert response.status_code == 400
    assert "transfer ownership" in response.json()["detail"].lower()


def test_leave_tournament_owner_can_leave_after_transfer(
    client, td_user, td_tournament, other_user, db
):
    grant_role(db, td_tournament, other_user, "Volunteer")
    login(client, "td@test.com", "tdpass")
    client.post(
        f"/tournaments/{td_tournament.id}/transfer-ownership/",
        json={"new_owner_id": other_user.id},
    )

    assert client.delete(f"/tournaments/{td_tournament.id}/memberships/me/").status_code == 204


def test_leave_tournament_non_member_gets_404(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")
    assert client.delete(f"/tournaments/{other_tournament.id}/memberships/me/").status_code == 404


def test_leave_tournament_not_found(client, td_user):
    login(client, "td@test.com", "tdpass")
    assert client.delete("/tournaments/9999/memberships/me/").status_code == 404


def test_leave_tournament_unauthenticated(client, td_tournament):
    assert client.delete(f"/tournaments/{td_tournament.id}/memberships/me/").status_code == 401


def test_leave_tournament_drops_role_assignments(client, td_user, other_tournament, db):
    """Cascade check — leaving must not orphan TournamentMembershipRole rows."""
    membership = grant_role(db, other_tournament, td_user, "Volunteer")
    membership_id = membership.id
    login(client, "td@test.com", "tdpass")

    assert client.delete(f"/tournaments/{other_tournament.id}/memberships/me/").status_code == 204
    assert (
        db.query(TournamentMembershipRole)
        .filter(TournamentMembershipRole.membership_id == membership_id)
        .count()
        == 0
    )
