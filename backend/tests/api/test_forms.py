"""Route tests for /forms/ (app/api/routes/forms.py). Model CRUD, field
helpers, slugify/uniqueness, the creates_membership_on_submit side effect,
and the access-control dependency functions are covered directly in
tests/core/test_forms.py — this file exercises the HTTP layer on top."""
import pytest

from tests.conftest import grant_role, login
from tests.api.chapter._helpers import make_chapter, make_university, make_user

from app.core.form import remove_form_field
from app.models.models import (
    ChapterMembership,
    Form,
    FormAnswer,
    FormField,
    FormResponse,
    TournamentMembership,
)


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------

def _make_form(db, user, tournament, **overrides):
    defaults = dict(
        owner_type="tournament",
        tournament_id=tournament.id,
        chapter_id=None,
        name="Test form",
        created_by=user.id,
    )
    defaults.update(overrides)
    form = Form(**defaults)
    db.add(form)
    db.flush()
    return form


def _make_chapter_form(db, user, chapter, **overrides):
    defaults = dict(
        owner_type="chapter",
        chapter_id=chapter.id,
        tournament_id=None,
        name="Test chapter form",
        created_by=user.id,
    )
    defaults.update(overrides)
    form = Form(**defaults)
    db.add(form)
    db.flush()
    return form


def _make_field(db, form, *, order=1, field_key="favorite_color", question_type="single_select_dropdown", **overrides):
    defaults = dict(
        form_id=form.id,
        order=order,
        label="Favorite color",
        description="Pick a color",
        question_type=question_type,
        field_key=field_key,
        config={
            "options": [
                {"id": "opt_1", "label": "Red", "archived": False, "next_section_id": None, "allow_other": False},
                {"id": "opt_2", "label": "Blue", "archived": False, "next_section_id": None, "allow_other": False},
            ]
        },
        is_archived=False,
    )
    defaults.update(overrides)
    field = FormField(**defaults)
    db.add(field)
    db.flush()
    return field


@pytest.fixture(name="chapter")
def chapter_fixture(db):
    university = make_university(db)
    return make_chapter(db, university.id)


def _chapter_lead(db, chapter, email="chapterlead@test.com", password="LeadPass123!"):
    user = make_user(db, email, password=password)
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=user.id, role="lead"))
    db.commit()
    return user


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/forms/ and POST /chapters/{chapter_id}/forms/
# ---------------------------------------------------------------------------

class TestCreateForm:
    def test_td_can_create_tournament_form(self, client, td_user, td_tournament):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/tournaments/{td_tournament.id}/forms/",
            json={"name": "Interest form", "owner_type": "tournament", "tournament_id": td_tournament.id},
        )
        assert res.status_code == 201
        data = res.json()
        assert data["owner_type"] == "tournament"
        assert data["tournament_id"] == td_tournament.id
        assert data["status"] == "draft"

    def test_non_member_forbidden_via_404(self, client, other_user, td_tournament):
        login(client, "other@test.com", "otherpass")
        res = client.post(
            f"/tournaments/{td_tournament.id}/forms/",
            json={"name": "Interest form", "owner_type": "tournament", "tournament_id": td_tournament.id},
        )
        assert res.status_code == 404

    def test_member_without_manage_forms_forbidden(self, client, db, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Runner")
        login(client, "other@test.com", "otherpass")
        res = client.post(
            f"/tournaments/{td_tournament.id}/forms/",
            json={"name": "Interest form", "owner_type": "tournament", "tournament_id": td_tournament.id},
        )
        assert res.status_code == 403

    def test_owner_type_mismatch_rejected(self, client, td_user, td_tournament):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/tournaments/{td_tournament.id}/forms/",
            json={"name": "Bad", "owner_type": "chapter", "chapter_id": 1},
        )
        assert res.status_code == 422

    def test_chapter_lead_can_create_chapter_form(self, client, db, chapter):
        _chapter_lead(db, chapter)
        login(client, "chapterlead@test.com", "LeadPass123!")
        res = client.post(
            f"/chapters/{chapter.id}/forms/",
            json={"name": "Alumni form", "owner_type": "chapter", "chapter_id": chapter.id},
        )
        assert res.status_code == 201
        assert res.json()["owner_type"] == "chapter"
        assert res.json()["chapter_id"] == chapter.id

    def test_chapter_plain_member_forbidden(self, client, db, chapter):
        member = make_user(db, "plainmember@test.com", password="MemberPass123!")
        db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
        db.commit()
        login(client, "plainmember@test.com", "MemberPass123!")
        res = client.post(
            f"/chapters/{chapter.id}/forms/",
            json={"name": "Alumni form", "owner_type": "chapter", "chapter_id": chapter.id},
        )
        assert res.status_code == 403

    def test_unauthenticated_forbidden(self, client, td_tournament):
        res = client.post(
            f"/tournaments/{td_tournament.id}/forms/",
            json={"name": "Interest form", "owner_type": "tournament", "tournament_id": td_tournament.id},
        )
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# GET /forms/{form_id}/
# ---------------------------------------------------------------------------

class TestGetForm:
    def test_manager_can_view(self, client, td_user, td_tournament, db):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/forms/{form.id}/")
        assert res.status_code == 200
        assert res.json()["id"] == form.id

    def test_plain_member_can_view(self, client, db, td_user, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Runner")
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "other@test.com", "otherpass")
        res = client.get(f"/forms/{form.id}/")
        assert res.status_code == 200

    def test_non_member_forbidden(self, client, db, td_user, td_tournament, other_user):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "other@test.com", "otherpass")
        res = client.get(f"/forms/{form.id}/")
        assert res.status_code == 403

    def test_non_member_allowed_when_creates_membership_on_submit(self, client, db, td_user, td_tournament, other_user):
        form = _make_form(db, td_user, td_tournament, creates_membership_on_submit=True)
        db.commit()
        login(client, "other@test.com", "otherpass")
        res = client.get(f"/forms/{form.id}/")
        assert res.status_code == 200

    def test_missing_form_404(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.get("/forms/9999/")
        assert res.status_code == 404

    def test_includes_active_fields_ordered(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        _make_field(db, form, order=2, field_key="second")
        _make_field(db, form, order=1, field_key="first")
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/forms/{form.id}/")
        keys = [f["field_key"] for f in res.json()["fields"]]
        assert keys == ["first", "second"]


# ---------------------------------------------------------------------------
# PATCH / archive / delete /forms/{form_id}/
# ---------------------------------------------------------------------------

class TestUpdateArchiveDeleteForm:
    def test_patch_updates_fields(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(f"/forms/{form.id}/", json={"name": "Renamed", "status": "published"})
        assert res.status_code == 200
        assert res.json()["name"] == "Renamed"
        assert res.json()["status"] == "published"

    def test_archive_sets_status(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.post(f"/forms/{form.id}/archive/")
        assert res.status_code == 200
        assert res.json()["status"] == "archived"

    def test_delete_succeeds_with_no_responses(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.delete(f"/forms/{form.id}/")
        assert res.status_code == 204
        assert db.query(Form).filter(Form.id == form.id).first() is None

    def test_delete_blocked_when_responses_exist(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.add(FormResponse(form_id=form.id, user_id=td_user.id))
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.delete(f"/forms/{form.id}/")
        assert res.status_code == 409
        assert db.query(Form).filter(Form.id == form.id).first() is not None


# ---------------------------------------------------------------------------
# POST /forms/{form_id}/fields/ — field_key required, TD-typed, slugified,
# tournament-wide uniqueness for tournament forms.
# ---------------------------------------------------------------------------

class TestCreateField:
    def test_create_field_slugifies_key(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/forms/{form.id}/fields/",
            json={"label": "Test Writing Interest", "field_key": "Test Writing Interest!", "question_type": "short_text"},
        )
        assert res.status_code == 201
        assert res.json()["field_key"] == "test_writing_interest"

    def test_field_key_collision_within_tournament_rejected(self, client, db, td_user, td_tournament):
        form_a = _make_form(db, td_user, td_tournament, name="Form A")
        form_b = _make_form(db, td_user, td_tournament, name="Form B")
        _make_field(db, form_a, field_key="shared_key")
        db.commit()

        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/forms/{form_b.id}/fields/",
            json={"label": "Anything", "field_key": "shared_key", "question_type": "short_text"},
        )
        assert res.status_code == 409

    def test_field_key_collision_across_forms_in_same_tournament_after_slugify(self, client, db, td_user, td_tournament):
        form_a = _make_form(db, td_user, td_tournament, name="Form A")
        form_b = _make_form(db, td_user, td_tournament, name="Form B")
        _make_field(db, form_a, field_key="shared_key")
        db.commit()

        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/forms/{form_b.id}/fields/",
            json={"label": "Anything", "field_key": "Shared Key!!", "question_type": "short_text"},
        )
        assert res.status_code == 409

    def test_archived_field_key_not_released_for_reuse(self, client, db, td_user, td_tournament):
        form_a = _make_form(db, td_user, td_tournament, name="Form A")
        form_b = _make_form(db, td_user, td_tournament, name="Form B")
        field = _make_field(db, form_a, field_key="was_used")
        response = FormResponse(form_id=form_a.id, user_id=td_user.id)
        db.add(response)
        db.flush()
        db.add(FormAnswer(response_id=response.id, field_id=field.id, value=["opt_1"]))
        db.commit()

        was_archived = remove_form_field(db, field)
        assert was_archived is True  # archived, not deleted, because it has an answer
        db.commit()

        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/forms/{form_b.id}/fields/",
            json={"label": "Anything", "field_key": "was_used", "question_type": "short_text"},
        )
        assert res.status_code == 409

    def test_chapter_forms_scope_uniqueness_per_form_only(self, client, db, td_user, chapter):
        form_a = _make_chapter_form(db, td_user, chapter, name="Form A")
        form_b = _make_chapter_form(db, td_user, chapter, name="Form B")
        _make_field(db, form_a, field_key="shared_key")
        db.commit()

        _chapter_lead(db, chapter)
        login(client, "chapterlead@test.com", "LeadPass123!")
        res = client.post(
            f"/forms/{form_b.id}/fields/",
            json={"label": "Anything", "field_key": "shared_key", "question_type": "short_text"},
        )
        # Different form -> allowed for chapter-owned forms (only per-form uniqueness applies)
        assert res.status_code == 201

    def test_missing_field_key_rejected(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/forms/{form.id}/fields/",
            json={"label": "No key", "question_type": "short_text"},
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# PATCH / DELETE /forms/{form_id}/fields/{field_id}/
# ---------------------------------------------------------------------------

class TestEditDeleteField:
    def test_patch_updates_label_and_order(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, order=1, field_key="color")
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(f"/forms/{form.id}/fields/{field.id}/", json={"label": "New label", "order": 3})
        assert res.status_code == 200
        assert res.json()["label"] == "New label"
        assert res.json()["order"] == 3

    def test_patch_question_type_replaces_field_keeping_key(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color")
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(f"/forms/{form.id}/fields/{field.id}/", json={"question_type": "multi_select"})
        assert res.status_code == 200
        assert res.json()["question_type"] == "multi_select"
        assert res.json()["field_key"] == "color"
        assert res.json()["id"] != field.id

    def test_delete_hard_deletes_when_no_answers(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color")
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.delete(f"/forms/{form.id}/fields/{field.id}/")
        assert res.status_code == 200
        assert res.json()["action"] == "deleted"

    def test_delete_archives_when_answers_exist(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color")
        response = FormResponse(form_id=form.id, user_id=td_user.id)
        db.add(response)
        db.flush()
        db.add(FormAnswer(response_id=response.id, field_id=field.id, value=["opt_1"]))
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.delete(f"/forms/{form.id}/fields/{field.id}/")
        assert res.status_code == 200
        assert res.json()["action"] == "archived"


# ---------------------------------------------------------------------------
# POST /forms/{form_id}/responses/ — submission and resubmission
# ---------------------------------------------------------------------------

class TestSubmitResponse:
    def test_first_submission_creates_response(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color")
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": field.id, "value": ["opt_1"]}]},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["form_id"] == form.id
        assert len(data["answers"]) == 1
        assert data["answers"][0]["value"] == ["opt_1"]

    def test_resubmission_overwrites_in_place(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color")
        db.commit()
        login(client, "td@test.com", "tdpass")

        client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_1"]}]})
        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_2"]}]})

        assert res.status_code == 200
        assert len(res.json()["answers"]) == 1
        assert res.json()["answers"][0]["value"] == ["opt_2"]
        assert db.query(FormResponse).filter(FormResponse.form_id == form.id, FormResponse.user_id == td_user.id).count() == 1

    def test_invalid_field_id_rejected(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": 9999, "value": "x"}]})
        assert res.status_code == 400

    def test_non_member_forbidden(self, client, db, td_user, td_tournament, other_user):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "other@test.com", "otherpass")
        res = client.post(f"/forms/{form.id}/responses/", json={"answers": []})
        assert res.status_code == 403

    def test_non_member_can_submit_when_creates_membership_on_submit(self, client, db, td_user, td_tournament, other_user):
        form = _make_form(db, td_user, td_tournament, creates_membership_on_submit=True)
        db.commit()
        login(client, "other@test.com", "otherpass")

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": []})
        assert res.status_code == 200

        membership = db.query(TournamentMembership).filter(
            TournamentMembership.user_id == other_user.id,
            TournamentMembership.tournament_id == td_tournament.id,
        ).one()
        assert membership.status == "interested"


# ---------------------------------------------------------------------------
# GET /forms/{form_id}/responses/ and /responses/me/
# ---------------------------------------------------------------------------

class TestListAndMyResponses:
    def test_manager_can_list_responses(self, client, db, td_user, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Runner")
        form = _make_form(db, td_user, td_tournament)
        db.add(FormResponse(form_id=form.id, user_id=other_user.id))
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/forms/{form.id}/responses/")
        assert res.status_code == 200
        assert len(res.json()) == 1

    def test_plain_member_cannot_list_responses(self, client, db, td_user, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Runner")
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "other@test.com", "otherpass")
        res = client.get(f"/forms/{form.id}/responses/")
        assert res.status_code == 403

    def test_me_returns_own_response(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.add(FormResponse(form_id=form.id, user_id=td_user.id))
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/forms/{form.id}/responses/me/")
        assert res.status_code == 200
        assert res.json()["user_id"] == td_user.id

    def test_me_404_when_no_response(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/forms/{form.id}/responses/me/")
        assert res.status_code == 404
