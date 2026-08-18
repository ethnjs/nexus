"""Tests for app/core/form — model CRUD building blocks, field-editing
helpers, field_key derivation/uniqueness, the creates_membership_on_submit
side effect, and the access-control dependency functions, all exercised
directly (no HTTP layer). See tests/api/test_forms.py for the routes."""
import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from tests.conftest import grant_role
from tests.api.chapter._helpers import make_chapter, make_university, make_user

from app.core.form import (
    field_key_taken_in_tournament,
    remove_form_field,
    remove_option_from_field,
    replace_field_type,
    slugify,
)
from app.core.form.membership import create_membership_on_first_submit
from app.core.form.permissions import require_form_manage_access, require_form_view_access
from app.models.models import (
    ChapterMembership,
    Form,
    FormAnswer,
    FormChapterMembershipConfig,
    FormField,
    FormResponse,
    FormTournamentMembershipConfig,
    TournamentMembership,
    TournamentMembershipRole,
    TournamentRole,
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


@pytest.fixture
def chapter(db):
    university = make_university(db)
    return make_chapter(db, university.id)


def _chapter_lead(db, chapter, email="chapterlead@test.com", password="LeadPass123!"):
    user = make_user(db, email, password=password)
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=user.id, role="lead"))
    db.commit()
    return user


# ---------------------------------------------------------------------------
# Model-level CRUD — Form, FormField, FormResponse, FormAnswer,
# FormTournamentMembershipConfig, FormChapterMembershipConfig
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

    def test_tournament_membership_config_round_trip(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, creates_membership_on_submit=True)
        db.add(FormTournamentMembershipConfig(form_id=form.id, status_on_submit="confirmed", role_ids_on_submit=[1, 2]))
        db.commit()
        db.refresh(form)

        assert form.tournament_membership_config.status_on_submit == "confirmed"
        assert form.tournament_membership_config.role_ids_on_submit == [1, 2]

    def test_chapter_membership_config_round_trip(self, db, td_user, chapter):
        form = _make_chapter_form(db, td_user, chapter, creates_membership_on_submit=True)
        db.add(FormChapterMembershipConfig(form_id=form.id, role_on_submit="officer"))
        db.commit()
        db.refresh(form)

        assert form.chapter_membership_config.role_on_submit == "officer"

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

    def test_remove_option_from_field_keeps_existing_answer_values(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, order=2, field_key="member_role")

        response = FormResponse(form_id=form.id, user_id=td_user.id)
        db.add(response)
        db.flush()

        answer = FormAnswer(response_id=response.id, field_id=field.id, value=["opt_1"])
        db.add(answer)
        db.flush()

        updated = remove_option_from_field(db, field, "opt_1")

        assert updated is field
        assert updated.config["options"][0]["archived"] is True
        assert db.query(FormAnswer).filter(FormAnswer.field_id == field.id).one().value == ["opt_1"]


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
# creates_membership_on_submit
# ---------------------------------------------------------------------------

class TestMembershipOnSubmit:
    def test_noop_when_flag_false(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, creates_membership_on_submit=False)
        db.commit()
        new_user = make_user(db, "flagoff@test.com", password="Pass123!")

        create_membership_on_first_submit(db, form, new_user)
        db.commit()

        assert db.query(TournamentMembership).filter(TournamentMembership.user_id == new_user.id).count() == 0

    def test_tournament_new_member_gets_default_status_and_no_roles(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, creates_membership_on_submit=True)
        db.commit()
        new_user = make_user(db, "newtdmember1@test.com", password="Pass123!")

        create_membership_on_first_submit(db, form, new_user)
        db.commit()

        membership = db.query(TournamentMembership).filter(
            TournamentMembership.user_id == new_user.id,
            TournamentMembership.tournament_id == td_tournament.id,
        ).one()
        assert membership.status == "interested"
        assert membership.source == "manual"
        assert db.query(TournamentMembershipRole).filter(TournamentMembershipRole.membership_id == membership.id).count() == 0

    def test_tournament_config_applies_status_and_roles(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, creates_membership_on_submit=True)
        role = TournamentRole(tournament_id=td_tournament.id, label="Custom Role", rank=99, permissions=[])
        db.add(role)
        db.flush()
        db.add(FormTournamentMembershipConfig(form_id=form.id, status_on_submit="confirmed", role_ids_on_submit=[role.id]))
        db.flush()
        new_user = make_user(db, "newtdmember2@test.com", password="Pass123!")

        create_membership_on_first_submit(db, form, new_user)
        db.commit()

        membership = db.query(TournamentMembership).filter(
            TournamentMembership.user_id == new_user.id,
            TournamentMembership.tournament_id == td_tournament.id,
        ).one()
        assert membership.status == "confirmed"

        role_ids = [
            r.role_id
            for r in db.query(TournamentMembershipRole).filter(TournamentMembershipRole.membership_id == membership.id)
        ]
        assert role_ids == [role.id]

    def test_tournament_skips_and_leaves_status_untouched_when_membership_exists(self, db, td_user, td_tournament):
        # td_user already has a "confirmed" membership via the td_tournament fixture
        form = _make_form(db, td_user, td_tournament, creates_membership_on_submit=True)
        db.add(FormTournamentMembershipConfig(form_id=form.id, status_on_submit="interested"))
        db.commit()

        create_membership_on_first_submit(db, form, td_user)
        db.commit()

        memberships = db.query(TournamentMembership).filter(
            TournamentMembership.user_id == td_user.id,
            TournamentMembership.tournament_id == td_tournament.id,
        ).all()
        assert len(memberships) == 1
        assert memberships[0].status == "confirmed"  # untouched, not reset to "interested"

    def test_chapter_new_member_gets_default_role(self, db, chapter):
        lead = _chapter_lead(db, chapter)
        form = _make_chapter_form(db, lead, chapter, creates_membership_on_submit=True)
        db.commit()
        new_user = make_user(db, "newchaptermember1@test.com", password="Pass123!")

        create_membership_on_first_submit(db, form, new_user)
        db.commit()

        membership = db.query(ChapterMembership).filter(ChapterMembership.user_id == new_user.id).one()
        assert membership.role == "member"
        assert membership.chapter_id == chapter.id

    def test_chapter_config_applies_role(self, db, chapter):
        lead = _chapter_lead(db, chapter)
        form = _make_chapter_form(db, lead, chapter, creates_membership_on_submit=True)
        db.add(FormChapterMembershipConfig(form_id=form.id, role_on_submit="officer"))
        db.commit()
        new_user = make_user(db, "newchaptermember2@test.com", password="Pass123!")

        create_membership_on_first_submit(db, form, new_user)
        db.commit()

        membership = db.query(ChapterMembership).filter(ChapterMembership.user_id == new_user.id).one()
        assert membership.role == "officer"

    def test_chapter_skips_if_user_already_in_a_different_chapter(self, db, chapter):
        other_university = make_university(db)
        other_chapter = make_chapter(db, other_university.id)
        user = make_user(db, "alreadyelsewhere@test.com", password="Pass123!")
        db.add(ChapterMembership(chapter_id=other_chapter.id, user_id=user.id, role="member"))
        db.commit()

        lead = _chapter_lead(db, chapter)
        form = _make_chapter_form(db, lead, chapter, creates_membership_on_submit=True)
        db.commit()

        create_membership_on_first_submit(db, form, user)
        db.commit()

        membership = db.query(ChapterMembership).filter(ChapterMembership.user_id == user.id).one()
        assert membership.chapter_id == other_chapter.id  # unchanged, no second row created


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

    def test_view_access_creates_membership_flag_bypasses_membership_requirement(self, db, td_user, td_tournament, other_user):
        form = _make_form(db, td_user, td_tournament, creates_membership_on_submit=True)
        db.commit()
        # other_user has NO membership in td_tournament at all
        result = require_form_view_access(form.id, db, other_user)
        assert result.id == form.id

    def test_view_access_without_flag_requires_membership(self, db, td_user, td_tournament, other_user):
        form = _make_form(db, td_user, td_tournament, creates_membership_on_submit=False)
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
