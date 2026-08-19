"""Route tests for /forms/ (app/api/routes/forms.py). Model CRUD, field
helpers, slugify/uniqueness, and the access-control dependency functions are
covered directly in tests/core/test_forms.py — this file exercises the HTTP
layer on top."""
from datetime import date, datetime, timedelta, timezone

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
    TournamentMembershipAvailability,
    TournamentMembershipLunch,
    TournamentShift,
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
            "required": False,
            "options": [
                {"value": "opt_1", "label": "Red"},
                {"value": "opt_2", "label": "Blue"},
            ],
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
        _make_field(db, form)
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
            json={
                "label": "Test Writing Interest",
                "field_key": "Test Writing Interest!",
                "question_type": "short_text",
                "config": {"required": False, "max_length": 500},
            },
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
            json={
                "label": "Anything",
                "field_key": "shared_key",
                "question_type": "short_text",
                "config": {"required": False, "max_length": 500},
            },
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

    def test_new_field_addable_to_form_with_existing_responses(self, client, db, td_user, td_tournament):
        """Locking only applies to fields that already have answers — adding
        a brand new field to an already-answered form is unaffected."""
        form = _make_form(db, td_user, td_tournament)
        existing_field = _make_field(db, form, field_key="color")
        response = FormResponse(form_id=form.id, user_id=td_user.id)
        db.add(response)
        db.flush()
        db.add(FormAnswer(response_id=response.id, field_id=existing_field.id, value=["opt_1"]))
        db.commit()

        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/forms/{form.id}/fields/",
            json={
                "label": "New question",
                "field_key": "new_question",
                "question_type": "short_text",
                "config": {"required": False, "max_length": 100},
            },
        )
        assert res.status_code == 201


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
        res = client.patch(f"/forms/{form.id}/fields/{field.id}/", json={"question_type": "multi_select_checkbox"})
        assert res.status_code == 200
        assert res.json()["question_type"] == "multi_select_checkbox"
        assert res.json()["field_key"] == "color"
        assert res.json()["id"] != field.id

    def test_patch_rejected_once_field_has_answers(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color")
        response = FormResponse(form_id=form.id, user_id=td_user.id)
        db.add(response)
        db.flush()
        db.add(FormAnswer(response_id=response.id, field_id=field.id, value=["opt_1"]))
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(f"/forms/{form.id}/fields/{field.id}/", json={"label": "New label"})
        assert res.status_code == 409
        assert db.query(FormField).filter(FormField.id == field.id).first().label == "Favorite color"

    def test_patch_allowed_when_field_has_no_answers(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color")
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(f"/forms/{form.id}/fields/{field.id}/", json={"label": "New label"})
        assert res.status_code == 200

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


# ---------------------------------------------------------------------------
# Write-through — availability/lunch reserved-key answers syncing into their
# structural tables (app/core/form/write_through.py), tournament-owned forms
# only. See tests/core/test_form_write_through.py for the diff-sync logic
# itself; this covers the route wiring.
# ---------------------------------------------------------------------------

class TestWriteThroughOnSubmit:
    def test_availability_write_through_on_tournament_form(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        shift = TournamentShift(
            tournament_id=td_tournament.id,
            label="Saturday",
            start=datetime.now(timezone.utc),
            end=datetime.now(timezone.utc) + timedelta(hours=8),
        )
        db.add(shift)
        db.flush()
        field = _make_field(
            db, form, field_key="availability", question_type="multi_select_checkbox",
            config={"required": False, "options": [{"value": str(shift.id), "label": shift.label}]},
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": field.id, "value": [str(shift.id)]}]},
        )
        assert res.status_code == 200

        membership = (
            db.query(TournamentMembership)
            .filter(TournamentMembership.user_id == td_user.id, TournamentMembership.tournament_id == td_tournament.id)
            .first()
        )
        rows = db.query(TournamentMembershipAvailability).filter(
            TournamentMembershipAvailability.membership_id == membership.id
        ).all()
        assert [row.tournament_shift_id for row in rows] == [shift.id]

    def test_lunch_write_through_on_tournament_form(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(
            db, form, field_key="lunch_20270213_protein", question_type="single_select_radio",
            config={
                "required": False,
                "options": [{"value": "chicken", "label": "Chicken"}, {"value": "tofu", "label": "Tofu"}],
            },
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": field.id, "value": "chicken"}]},
        )
        assert res.status_code == 200

        membership = (
            db.query(TournamentMembership)
            .filter(TournamentMembership.user_id == td_user.id, TournamentMembership.tournament_id == td_tournament.id)
            .first()
        )
        rows = db.query(TournamentMembershipLunch).filter(
            TournamentMembershipLunch.membership_id == membership.id
        ).all()
        assert len(rows) == 1
        assert rows[0].value == "chicken"
        assert rows[0].label == "Chicken"
        assert rows[0].category == "protein"
        assert rows[0].date == date(2027, 2, 13)

    def test_availability_answer_on_chapter_form_saves_but_does_not_write_through(self, client, db, td_user, chapter):
        form = _make_chapter_form(db, td_user, chapter)
        field = _make_field(
            db, form, field_key="availability", question_type="multi_select_checkbox",
            config={"required": False, "options": [{"value": "not_a_real_shift_id", "label": "Whenever"}]},
        )
        db.commit()
        _chapter_lead(db, chapter)
        login(client, "chapterlead@test.com", "LeadPass123!")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": field.id, "value": ["not_a_real_shift_id"]}]},
        )
        assert res.status_code == 200
        assert res.json()["answers"][0]["value"] == ["not_a_real_shift_id"]
        assert db.query(TournamentMembershipAvailability).count() == 0

    def test_lunch_answer_on_chapter_form_saves_but_does_not_write_through(self, client, db, td_user, chapter):
        form = _make_chapter_form(db, td_user, chapter)
        field = _make_field(
            db, form, field_key="lunch_20270213_protein", question_type="single_select_radio",
            config={"required": False, "options": [{"value": "chicken", "label": "Chicken"}]},
        )
        db.commit()
        _chapter_lead(db, chapter)
        login(client, "chapterlead@test.com", "LeadPass123!")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": field.id, "value": "chicken"}]},
        )
        assert res.status_code == 200
        assert db.query(TournamentMembershipLunch).count() == 0


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


# ---------------------------------------------------------------------------
# Reserved field_key <-> question_type pairing (validated identically on
# tournament- and chapter-owned forms — see form-question-types-reference.md)
# ---------------------------------------------------------------------------

class TestReservedFieldKeyRoutes:
    def test_availability_wrong_type_rejected_on_tournament_form(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/forms/{form.id}/fields/",
            json={
                "label": "Availability",
                "field_key": "availability",
                "question_type": "single_select_dropdown",
                "config": {"required": False, "options": [{"value": "1", "label": "Saturday"}]},
            },
        )
        assert res.status_code == 422

    def test_availability_wrong_type_rejected_on_chapter_form(self, client, db, td_user, chapter):
        form = _make_chapter_form(db, td_user, chapter)
        db.commit()
        _chapter_lead(db, chapter)
        login(client, "chapterlead@test.com", "LeadPass123!")
        res = client.post(
            f"/forms/{form.id}/fields/",
            json={
                "label": "Availability",
                "field_key": "availability",
                "question_type": "single_select_dropdown",
                "config": {"required": False, "options": [{"value": "1", "label": "Saturday"}]},
            },
        )
        assert res.status_code == 422

    def test_availability_valid_type_accepted_on_chapter_form_no_shift_check(self, client, db, td_user, chapter):
        # Chapter forms have no tournament shift catalog to validate
        # against, so any option value is accepted — stores as a normal
        # FormAnswer, no write-through (write-through is tournament-only).
        form = _make_chapter_form(db, td_user, chapter)
        db.commit()
        _chapter_lead(db, chapter)
        login(client, "chapterlead@test.com", "LeadPass123!")
        res = client.post(
            f"/forms/{form.id}/fields/",
            json={
                "label": "Availability",
                "field_key": "availability",
                "question_type": "multi_select_checkbox",
                "config": {"required": False, "options": [{"value": "not_a_real_shift_id", "label": "Whenever"}]},
            },
        )
        assert res.status_code == 201

    def test_availability_option_must_resolve_to_real_shift_on_tournament_form(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/forms/{form.id}/fields/",
            json={
                "label": "Availability",
                "field_key": "availability",
                "question_type": "multi_select_checkbox",
                "config": {"required": False, "options": [{"value": "9999", "label": "Nonexistent shift"}]},
            },
        )
        assert res.status_code == 422

    def test_availability_valid_shift_accepted_on_tournament_form(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        shift = TournamentShift(
            tournament_id=td_tournament.id,
            label="Saturday",
            start=datetime.now(timezone.utc),
            end=datetime.now(timezone.utc) + timedelta(hours=8),
        )
        db.add(shift)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/forms/{form.id}/fields/",
            json={
                "label": "Availability",
                "field_key": "availability",
                "question_type": "multi_select_checkbox",
                "config": {"required": False, "options": [{"value": str(shift.id), "label": shift.label}]},
            },
        )
        assert res.status_code == 201

    def test_event_preference_disallowed_type_rejected(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/forms/{form.id}/fields/",
            json={
                "label": "Event Preference",
                "field_key": "event_preference",
                "question_type": "short_text",
                "config": {"required": False, "max_length": 100},
            },
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# Submission-time required enforcement via branching reachability replay
# ---------------------------------------------------------------------------

class TestSubmissionReachabilityEnforcement:
    def test_submission_rejected_when_reachable_required_field_missing(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        required_field = _make_field(
            db, form, order=1, field_key="required_field", question_type="short_text",
            config={"required": True, "max_length": 100},
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": []})
        assert res.status_code == 400

    def test_submission_accepted_when_branch_skips_required_field(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        skipped = _make_field(
            db, form, order=2, field_key="skipped", question_type="short_text",
            config={"required": True, "max_length": 100},
        )
        target = _make_field(db, form, order=3, field_key="target", question_type="short_text",
                              config={"required": False, "max_length": 100})
        branch_field = _make_field(
            db, form, order=1, field_key="branch", question_type="single_select_radio",
            config={
                "required": True,
                "options": [
                    {"value": "yes", "label": "Yes", "next_field_id": target.id},
                    {"value": "no", "label": "No"},
                ],
            },
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": branch_field.id, "value": "yes"}]},
        )
        assert res.status_code == 200
