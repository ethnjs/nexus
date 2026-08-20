"""Tests for app/core/form — model CRUD building blocks, field-editing
helpers, field_key derivation/uniqueness, and the access-control dependency
functions, all exercised directly (no HTTP layer). See tests/api/test_forms.py
for the routes."""
import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from tests.conftest import grant_role
from tests.api.chapter._helpers import make_chapter, make_university, make_user

from datetime import datetime, timedelta, timezone

from app.core.form import (
    field_key_taken_in_tournament,
    remove_form_field,
    replace_field_type,
    resolve_field_options,
    slugify,
)
from app.core.form.permissions import require_form_manage_access, require_form_view_access
from app.models.models import (
    ChapterMembership,
    Form,
    FormAnswer,
    FormField,
    FormResponse,
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
            "options": [
                {"option_id": "opt_1", "value": "red", "label": "Red", "is_archived": False},
                {"option_id": "opt_2", "value": "blue", "label": "Blue", "is_archived": False},
            ]
        },
        is_archived=False,
    )
    defaults.update(overrides)
    field = FormField(**defaults)
    db.add(field)
    db.flush()
    return field


@pytest.fixture
def chapter(db):
    university = make_university(db)
    return make_chapter(db, university.id)


def _chapter_lead(db, chapter, email="chapterlead@test.com", password="LeadPass123!"):
    user = make_user(db, email, password=password)
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=user.id, role="lead"))
    db.commit()
    return user


def _make_shift(db, tournament, label, start, end):
    shift = TournamentShift(tournament_id=tournament.id, label=label, start=start, end=end)
    db.add(shift)
    db.flush()
    return shift


# ---------------------------------------------------------------------------
# Model-level CRUD — Form, FormField, FormResponse, FormAnswer
# ---------------------------------------------------------------------------

class TestModelCRUD:
    def test_create_tournament_form(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        stored = db.query(Form).filter(Form.id == form.id).one()
        assert stored.owner_type == "tournament"
        assert stored.tournament_id == td_tournament.id
        assert stored.chapter_id is None
        assert stored.status == "draft"

    def test_create_chapter_form(self, db, td_user, chapter):
        form = _make_chapter_form(db, td_user, chapter)
        db.commit()
        stored = db.query(Form).filter(Form.id == form.id).one()
        assert stored.owner_type == "chapter"
        assert stored.chapter_id == chapter.id
        assert stored.tournament_id is None

    def test_owner_check_constraint_rejects_both_ids_set(self, db, td_user, td_tournament, chapter):
        form = Form(
            owner_type="tournament",
            tournament_id=td_tournament.id,
            chapter_id=chapter.id,
            name="Bad form",
            created_by=td_user.id,
        )
        db.add(form)
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()

    def test_owner_check_constraint_rejects_neither_id_set(self, db, td_user):
        form = Form(owner_type="tournament", name="Bad form", created_by=td_user.id)
        db.add(form)
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()

    def test_field_key_is_required(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        with pytest.raises(ValueError):
            FormField(form_id=form.id, order=1, label="No key", question_type="short_text", field_key=None)

    def test_field_key_must_be_alnum_underscore(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        with pytest.raises(ValueError):
            FormField(form_id=form.id, order=1, label="Bad key", question_type="short_text", field_key="bad key!")

    def test_field_key_unique_within_form(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        _make_field(db, form, field_key="dup")
        db.add(FormField(form_id=form.id, order=2, label="Second", question_type="short_text", field_key="dup"))
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()

    def test_create_response_and_answer(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form)

        response = FormResponse(form_id=form.id, user_id=td_user.id)
        db.add(response)
        db.flush()

        answer = FormAnswer(response_id=response.id, field_id=field.id, value=["opt_1"])
        db.add(answer)
        db.commit()

        stored = db.query(FormAnswer).filter(FormAnswer.response_id == response.id).one()
        assert stored.value == ["opt_1"]

    def test_response_unique_per_form_and_user(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.add(FormResponse(form_id=form.id, user_id=td_user.id))
        db.commit()

        db.add(FormResponse(form_id=form.id, user_id=td_user.id))
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()

    def test_deleting_tournament_cascades_to_forms(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        form_id = form.id

        db.delete(td_tournament)
        db.commit()

        assert db.query(Form).filter(Form.id == form_id).first() is None


# ---------------------------------------------------------------------------
# Field-editing helpers
# ---------------------------------------------------------------------------

class TestFieldHelpers:
    def test_remove_form_field_archives_when_answers_exist(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, order=1, field_key="favorite_color")

        response = FormResponse(form_id=form.id, user_id=td_user.id)
        db.add(response)
        db.flush()

        answer = FormAnswer(response_id=response.id, field_id=field.id, value=["opt_1"])
        db.add(answer)
        db.flush()

        removed = remove_form_field(db, field)

        assert removed is True
        db.refresh(field)
        assert field.is_archived is True
        assert db.query(FormAnswer).filter(FormAnswer.field_id == field.id).one().value == ["opt_1"]

    def test_remove_form_field_hard_deletes_when_no_answers(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="no_answers_yet")

        removed = remove_form_field(db, field)

        assert removed is False
        assert db.query(FormField).filter(FormField.id == field.id).first() is None

    def test_replace_field_type_archives_old_field_and_keeps_order(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, order=7, field_key="tshirt_size")

        replacement = replace_field_type(db, field, "multi_select")

        db.refresh(field)
        assert field.is_archived is True
        assert field.field_key.endswith(f"_archived_{field.id}")

        assert replacement is not field
        assert replacement.form_id == form.id
        assert replacement.order == field.order
        assert replacement.question_type == "multi_select"
        assert replacement.field_key == "tshirt_size"
        assert replacement.is_archived is False


# ---------------------------------------------------------------------------
# resolve_field_options — availability combined display
# ---------------------------------------------------------------------------

class TestResolveAvailabilityOptions:
    def test_single_shift_option_resolves_its_own_range(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        start = datetime(2027, 2, 13, 7, 0, tzinfo=timezone.utc)
        end = datetime(2027, 2, 13, 16, 0, tzinfo=timezone.utc)
        shift = _make_shift(db, td_tournament, "Saturday", start, end)
        field = _make_field(
            db, form, field_key="availability", question_type="single_select_radio",
            config={"options": [{"option_id": "opt_1", "value": [shift.id], "label": "Saturday", "is_archived": False}]},
        )
        db.commit()

        options = resolve_field_options(db, field)
        assert options == [{"option_id": "opt_1", "label": "Saturday", "start": start, "end": end}]

    def test_grouped_shifts_resolve_combined_range(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        morning_start = datetime(2027, 2, 13, 7, 0, tzinfo=timezone.utc)
        morning_end = datetime(2027, 2, 13, 12, 0, tzinfo=timezone.utc)
        afternoon_start = datetime(2027, 2, 13, 12, 0, tzinfo=timezone.utc)
        afternoon_end = datetime(2027, 2, 13, 16, 0, tzinfo=timezone.utc)
        morning = _make_shift(db, td_tournament, "Morning", morning_start, morning_end)
        afternoon = _make_shift(db, td_tournament, "Afternoon", afternoon_start, afternoon_end)
        field = _make_field(
            db, form, field_key="availability", question_type="multi_select_checkbox",
            config={
                "options": [
                    {"option_id": "opt_all_day", "value": [morning.id, afternoon.id], "label": "All Day", "is_archived": False},
                ],
            },
        )
        db.commit()

        options = resolve_field_options(db, field)
        assert options == [{"option_id": "opt_all_day", "label": "All Day", "start": morning_start, "end": afternoon_end}]

    def test_raw_shift_ids_not_exposed(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        shift = _make_shift(
            db, td_tournament, "Saturday",
            datetime(2027, 2, 13, 7, 0, tzinfo=timezone.utc), datetime(2027, 2, 13, 16, 0, tzinfo=timezone.utc),
        )
        field = _make_field(
            db, form, field_key="availability", question_type="single_select_radio",
            config={"options": [{"option_id": "opt_1", "value": [shift.id], "label": "Saturday", "is_archived": False}]},
        )
        db.commit()

        options = resolve_field_options(db, field)
        assert "value" not in options[0]

    def test_archived_option_excluded(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        shift = _make_shift(
            db, td_tournament, "Saturday",
            datetime(2027, 2, 13, 7, 0, tzinfo=timezone.utc), datetime(2027, 2, 13, 16, 0, tzinfo=timezone.utc),
        )
        field = _make_field(
            db, form, field_key="availability", question_type="single_select_radio",
            config={"options": [{"option_id": "opt_1", "value": [shift.id], "label": "Saturday", "is_archived": True}]},
        )
        db.commit()

        assert resolve_field_options(db, field) == []

    def test_non_availability_field_returns_raw_options(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form)  # default config, field_key="favorite_color"
        db.commit()

        options = resolve_field_options(db, field)
        assert options == field.config["options"]


# ---------------------------------------------------------------------------
# slugify / field_key_taken_in_tournament
# ---------------------------------------------------------------------------

class TestSlugifyAndUniqueness:
    def test_slugify_lowercases_and_strips_punctuation(self):
        assert slugify("Test Writing Interest!") == "test_writing_interest"

    def test_slugify_collapses_repeated_separators(self):
        assert slugify("  a   b--c__d  ") == "a_b_c_d"

    def test_slugify_truncates_to_max_len(self):
        assert len(slugify("x" * 100, max_len=10)) == 10

    def test_field_key_taken_true_across_different_forms_in_same_tournament(self, db, td_user, td_tournament):
        form_a = _make_form(db, td_user, td_tournament, name="Form A")
        form_b = _make_form(db, td_user, td_tournament, name="Form B")
        _make_field(db, form_a, field_key="shared")
        db.commit()

        assert field_key_taken_in_tournament(db, td_tournament.id, "shared") is True
        # form_b hasn't used the key itself, but it's still blocked tournament-wide
        assert db.query(FormField).filter(FormField.form_id == form_b.id).count() == 0

    def test_field_key_taken_false_for_different_tournament(self, db, td_user, td_tournament, other_user, other_tournament):
        form = _make_form(db, td_user, td_tournament)
        _make_field(db, form, field_key="only_here")
        db.commit()

        assert field_key_taken_in_tournament(db, other_tournament.id, "only_here") is False

    def test_field_key_taken_true_when_archived(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        _make_field(db, form, field_key="was_used", is_archived=True)
        db.commit()

        assert field_key_taken_in_tournament(db, td_tournament.id, "was_used") is True


# ---------------------------------------------------------------------------
# require_form_manage_access / require_form_view_access
# ---------------------------------------------------------------------------

class TestAccessDependencies:
    def test_manage_access_tournament_manager_passes(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        result = require_form_manage_access(form.id, db, td_user)
        assert result.id == form.id

    def test_manage_access_tournament_non_member_gets_404(self, db, td_user, td_tournament, other_user):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        with pytest.raises(HTTPException) as exc_info:
            require_form_manage_access(form.id, db, other_user)
        assert exc_info.value.status_code == 404

    def test_manage_access_tournament_member_without_permission_gets_403(self, db, td_user, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Runner")
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        with pytest.raises(HTTPException) as exc_info:
            require_form_manage_access(form.id, db, other_user)
        assert exc_info.value.status_code == 403

    def test_manage_access_chapter_lead_passes(self, db, chapter):
        lead = _chapter_lead(db, chapter)
        form = _make_chapter_form(db, lead, chapter)
        db.commit()
        result = require_form_manage_access(form.id, db, lead)
        assert result.id == form.id

    def test_manage_access_chapter_plain_member_gets_403(self, db, chapter):
        lead = _chapter_lead(db, chapter)
        form = _make_chapter_form(db, lead, chapter)
        member = make_user(db, "plainaccess@test.com", password="Pass123!")
        db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
        db.commit()
        with pytest.raises(HTTPException) as exc_info:
            require_form_manage_access(form.id, db, member)
        assert exc_info.value.status_code == 403

    def test_view_access_non_member_requires_membership(self, db, td_user, td_tournament, other_user):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        with pytest.raises(HTTPException) as exc_info:
            require_form_view_access(form.id, db, other_user)
        assert exc_info.value.status_code == 403

    def test_view_access_plain_member_passes_without_manage_permission(self, db, td_user, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Runner")
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        result = require_form_view_access(form.id, db, other_user)
        assert result.id == form.id
