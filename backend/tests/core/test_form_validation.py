"""Tests for app/core/form/validation.py — per-question_type config shape
(delegated to the pydantic schemas in app/schemas/form.py), reserved
field_key pairing, branching option targets, availability's TournamentShift
resolution, and the aggregate whole-form publish pass. See
tests/api/test_forms.py for the route-level wiring of these checks."""
from datetime import datetime, timedelta, timezone

import pytest

from tests.api.chapter._helpers import make_chapter, make_university

from app.core.form.validation import (
    FormFieldValidationError,
    validate_availability_options,
    validate_branching_options,
    validate_field_config,
    validate_form_for_publish,
    validate_reserved_field_key,
)
from app.models.models import Form, FormField, TournamentShift


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
        description=None,
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


def _make_shift(db, tournament, label="Saturday"):
    shift = TournamentShift(
        tournament_id=tournament.id,
        label=label,
        start=datetime.now(timezone.utc),
        end=datetime.now(timezone.utc) + timedelta(hours=8),
    )
    db.add(shift)
    db.flush()
    return shift


@pytest.fixture
def chapter(db):
    university = make_university(db)
    return make_chapter(db, university.id)


# ---------------------------------------------------------------------------
# validate_field_config — per-question_type shape
# ---------------------------------------------------------------------------

class TestValidateFieldConfig:
    def test_unknown_question_type_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config("grid", {})

    def test_missing_required_key_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config("short_text", {"max_length": 100})

    def test_acknowledgment_missing_confirm_label_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config("acknowledgment", {"required": True})

    def test_acknowledgment_valid_passes(self):
        normalized = validate_field_config("acknowledgment", {"required": True, "confirm_label": "I understand"})
        assert normalized == {"required": True, "confirm_label": "I understand"}

    def test_single_select_missing_options_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config("single_select_radio", {"required": True})

    def test_single_select_duplicate_option_values_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config(
                "single_select_radio",
                {"required": True, "options": [{"value": "a", "label": "A"}, {"value": "a", "label": "A2"}]},
            )

    def test_single_select_option_missing_value_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config("single_select_dropdown", {"required": True, "options": [{"label": "A"}]})

    def test_multi_select_checkbox_rejects_branching_keys_on_option(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config(
                "multi_select_checkbox",
                {"required": True, "options": [{"value": "a", "label": "A", "next_field_id": 5}]},
            )

    def test_ranked_choice_missing_allow_duplicates_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config(
                "ranked_choice",
                {"required": True, "ranks": 1, "options": [{"value": "a", "label": "A"}]},
            )

    def test_ranked_choice_ranks_exceeds_options_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config(
                "ranked_choice",
                {
                    "required": True,
                    "ranks": 3,
                    "allow_duplicates": False,
                    "options": [{"value": "a", "label": "A"}],
                },
            )

    def test_ranked_choice_valid_passes(self):
        normalized = validate_field_config(
            "ranked_choice",
            {
                "required": True,
                "ranks": 2,
                "allow_duplicates": False,
                "options": [{"value": "a", "label": "A"}, {"value": "b", "label": "B"}],
            },
        )
        assert normalized["ranks"] == 2

    def test_short_text_missing_max_length_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config("short_text", {"required": False})

    def test_short_text_negative_max_length_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config("short_text", {"required": False, "max_length": -1})

    def test_long_text_valid_passes(self):
        normalized = validate_field_config("long_text", {"required": False, "max_length": 1000})
        assert normalized == {"required": False, "max_length": 1000}


# ---------------------------------------------------------------------------
# validate_reserved_field_key
# ---------------------------------------------------------------------------

class TestValidateReservedFieldKey:
    def test_availability_requires_multi_select_checkbox(self):
        with pytest.raises(FormFieldValidationError):
            validate_reserved_field_key("availability", "single_select_dropdown")

    def test_availability_with_multi_select_checkbox_passes(self):
        validate_reserved_field_key("availability", "multi_select_checkbox")  # no raise

    @pytest.mark.parametrize("question_type", ["ranked_choice", "multi_select_checkbox", "single_select_dropdown"])
    def test_event_preference_allowed_types_pass(self, question_type):
        validate_reserved_field_key("event_preference", question_type)  # no raise

    def test_event_preference_disallowed_type_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_reserved_field_key("event_preference", "short_text")

    def test_non_reserved_key_any_type_allowed(self):
        validate_reserved_field_key("favorite_color", "acknowledgment")  # no raise


# ---------------------------------------------------------------------------
# validate_branching_options
# ---------------------------------------------------------------------------

class TestValidateBranchingOptions:
    def test_missing_next_field_id_target_rejected(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        config = {"required": False, "options": [{"value": "yes", "label": "Yes", "next_field_id": 9999}]}
        with pytest.raises(FormFieldValidationError):
            validate_branching_options(db, form.id, "single_select_radio", config)

    def test_valid_next_field_id_target_passes(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        target = _make_field(db, form, field_key="target")
        db.commit()
        config = {"required": False, "options": [{"value": "yes", "label": "Yes", "next_field_id": target.id}]}
        validate_branching_options(db, form.id, "single_select_radio", config)  # no raise

    def test_self_reference_rejected(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="self_ref")
        db.commit()
        config = {"required": False, "options": [{"value": "yes", "label": "Yes", "next_field_id": field.id}]}
        with pytest.raises(FormFieldValidationError):
            validate_branching_options(db, form.id, "single_select_radio", config, field_id=field.id)

    def test_archived_target_rejected(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        target = _make_field(db, form, field_key="target", is_archived=True)
        db.commit()
        config = {"required": False, "options": [{"value": "yes", "label": "Yes", "next_field_id": target.id}]}
        with pytest.raises(FormFieldValidationError):
            validate_branching_options(db, form.id, "single_select_radio", config)

    def test_non_branching_type_is_a_noop(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        # multi_select_checkbox options can't structurally carry next_field_id
        # (the schema forbids it) — validate_branching_options just skips
        # non-branching types entirely regardless of config contents.
        validate_branching_options(db, form.id, "multi_select_checkbox", {"options": []})  # no raise


# ---------------------------------------------------------------------------
# validate_availability_options
# ---------------------------------------------------------------------------

class TestValidateAvailabilityOptions:
    def test_chapter_owned_form_skips_check(self, db):
        # tournament_id=None (chapter-owned) — no shift catalog to check against
        config = {"options": [{"value": "not_a_real_shift_id", "label": "Whenever"}]}
        validate_availability_options(db, None, config)  # no raise

    def test_valid_shift_ids_pass(self, db, td_user, td_tournament):
        shift = _make_shift(db, td_tournament)
        db.commit()
        config = {"options": [{"value": str(shift.id), "label": shift.label}]}
        validate_availability_options(db, td_tournament.id, config)  # no raise

    def test_shift_id_not_on_tournament_rejected(self, db, td_user, td_tournament, other_user, other_tournament):
        shift = _make_shift(db, other_tournament)
        db.commit()
        config = {"options": [{"value": str(shift.id), "label": shift.label}]}
        with pytest.raises(FormFieldValidationError):
            validate_availability_options(db, td_tournament.id, config)

    def test_non_numeric_value_rejected(self, db, td_user, td_tournament):
        config = {"options": [{"value": "not_a_shift_id", "label": "Whenever"}]}
        with pytest.raises(FormFieldValidationError):
            validate_availability_options(db, td_tournament.id, config)


# ---------------------------------------------------------------------------
# validate_form_for_publish — aggregate pass
# ---------------------------------------------------------------------------

class TestValidateFormForPublish:
    def test_empty_form_rejected(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        with pytest.raises(FormFieldValidationError, match="no fields"):
            validate_form_for_publish(db, form)

    def test_valid_form_passes(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        _make_field(db, form)
        db.commit()
        validate_form_for_publish(db, form)  # no raise

    def test_dangling_next_field_id_rejected(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        # a field whose branching option jumps to a field that no longer
        # exists (e.g. archived after this field was last saved) — caught
        # only by the aggregate pass, not by per-field create/update checks.
        _make_field(
            db,
            form,
            question_type="single_select_radio",
            config={"required": False, "options": [{"value": "yes", "label": "Yes", "next_field_id": 9999}]},
        )
        db.commit()
        with pytest.raises(FormFieldValidationError, match="next_field_id"):
            validate_form_for_publish(db, form)

    def test_archived_fields_excluded_from_pass(self, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        _make_field(db, form, is_archived=True, config={"bad": "shape"})
        _make_field(db, form, order=2, field_key="second")
        db.commit()
        validate_form_for_publish(db, form)  # no raise — archived field's bad config is ignored
