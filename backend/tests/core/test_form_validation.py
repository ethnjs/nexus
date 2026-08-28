"""Tests for app/core/form/validation.py — per-question_type config shape
(delegated to the pydantic schemas in app/schemas/form.py), reserved
field_key pairing, branching option targets, availability's TournamentShift
resolution, and the aggregate whole-form publish pass. See
tests/api/test_forms.py for the route-level wiring of these checks."""
from datetime import date, datetime, timedelta, timezone

import pytest

from tests.api.chapter._helpers import make_chapter, make_university

from app.core.form.validation import (
    FormFieldValidationError,
    option_shift_ids,
    option_track_assignments,
    validate_availability_options,
    validate_branching_options,
    validate_field_config,
    validate_form_for_publish,
    validate_reserved_field_key,
    validate_track_status_options,
    validate_tournament_preset,
)
from app.models.models import Form, FormField, TournamentShift, TournamentTrack


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
                {"option_id": "opt_1", "value": "opt_1", "label": "Red"},
                {"option_id": "opt_2", "value": "opt_2", "label": "Blue"},
            ],
        },
        is_archived=False,
    )
    defaults.update(overrides)
    field = FormField(**defaults)
    db.add(field)
    db.flush()
    return field


def _make_shift(db, tournament, label="Saturday", day=None):
    start = datetime(2026, 3, 15, tzinfo=timezone.utc) if day is None else day
    shift = TournamentShift(
        tournament_id=tournament.id,
        label=label,
        start=start,
        end=start + timedelta(hours=8),
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
                {
                    "required": True,
                    "options": [
                        {"option_id": "opt_1", "value": "a", "label": "A"},
                        {"option_id": "opt_2", "value": "a", "label": "A2"},
                    ],
                },
            )

    def test_entity_backed_options_may_share_a_value(self):
        """On an availability/event_preference question the answer records
        option_id, so two options grouping the same entities are redundant
        rather than ambiguous — and several empty ones is the ordinary state
        while the TD is still picking."""
        validate_field_config(
            "multi_select_checkbox",
            {
                "required": False,
                "options": [
                    {"option_id": "opt_1", "value": [], "label": "Morning"},
                    {"option_id": "opt_2", "value": [], "label": "Afternoon"},
                    {"option_id": "opt_3", "value": [3, 2], "label": "All day"},
                    {"option_id": "opt_4", "value": [3, 2], "label": "Both halves"},
                ],
            },
        )

    def test_duplicate_option_id_still_rejected(self):
        """option_id is the durable identity — a collision there really does
        make selection ambiguous."""
        with pytest.raises(FormFieldValidationError, match="duplicate option_id"):
            validate_field_config(
                "multi_select_checkbox",
                {
                    "required": False,
                    "options": [
                        {"option_id": "same", "value": [1], "label": "One"},
                        {"option_id": "same", "value": [2], "label": "Two"},
                    ],
                },
            )

    def test_single_select_option_missing_value_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config(
                "single_select_dropdown",
                {"required": True, "options": [{"option_id": "opt_1", "label": "A"}]},
            )

    def test_multi_select_checkbox_rejects_branching_keys_on_option(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config(
                "multi_select_checkbox",
                {
                    "required": True,
                    "options": [{"option_id": "opt_1", "value": "a", "label": "A", "next_field_id": 5}],
                },
            )

    def test_ranked_choice_missing_allow_duplicates_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config(
                "ranked_choice",
                {"required": True, "ranks": 1, "options": [{"option_id": "opt_1", "value": "a", "label": "A"}]},
            )

    def test_ranked_choice_ranks_exceeds_options_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config(
                "ranked_choice",
                {
                    "required": True,
                    "ranks": 3,
                    "allow_duplicates": False,
                    "options": [{"option_id": "opt_1", "value": "a", "label": "A"}],
                },
            )

    def test_ranked_choice_valid_passes(self):
        normalized = validate_field_config(
            "ranked_choice",
            {
                "required": True,
                "ranks": 2,
                "allow_duplicates": False,
                "options": [
                    {"option_id": "opt_1", "value": "a", "label": "A"},
                    {"option_id": "opt_2", "value": "b", "label": "B"},
                ],
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
    def test_availability_disallowed_type_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_reserved_field_key("availability_20260315", "single_select_dropdown")

    @pytest.mark.parametrize("question_type", ["single_select_radio", "multi_select_checkbox"])
    def test_availability_allowed_types_pass(self, question_type):
        validate_reserved_field_key("availability_20260315", question_type)  # no raise

    @pytest.mark.parametrize("question_type", ["ranked_choice", "multi_select_checkbox", "single_select_dropdown"])
    def test_event_preference_allowed_types_pass(self, question_type):
        validate_reserved_field_key("event_preference_morning", question_type)  # no raise

    def test_event_preference_disallowed_type_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_reserved_field_key("event_preference_morning", "short_text")

    def test_bare_availability_key_no_longer_reserved(self):
        # No date suffix -> not a reserved key at all, so any question_type
        # is allowed (same as any other non-reserved field_key).
        validate_reserved_field_key("availability", "short_text")  # no raise

    def test_bare_event_preference_key_no_longer_reserved(self):
        validate_reserved_field_key("event_preference", "short_text")  # no raise

    def test_non_reserved_key_any_type_allowed(self):
        validate_reserved_field_key("favorite_color", "acknowledgment")  # no raise

    @pytest.mark.parametrize("question_type", ["single_select_radio", "multi_select_checkbox"])
    def test_track_status_allowed_types_pass(self, question_type):
        validate_reserved_field_key("track_status_volunteer_interest", question_type)  # no raise

    def test_track_status_disallowed_type_rejected(self):
        with pytest.raises(FormFieldValidationError):
            validate_reserved_field_key("track_status_volunteer_interest", "single_select_dropdown")


class TestValidateTournamentPreset:
    @pytest.mark.parametrize("field_key", [
        "availability_20260315",
        "event_preference_morning",
        "lunch_20260315_protein",
        "track_status_interest",
    ])
    def test_presets_reject_chapter_owned_forms(self, field_key):
        with pytest.raises(FormFieldValidationError, match="tournament-owned"):
            validate_tournament_preset(field_key, None)

    def test_custom_field_is_valid_without_tournament(self):
        validate_tournament_preset("favorite_color", None)


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
        config = {"options": [{"value": ["not_a_real_shift_id"], "label": "Whenever"}]}
        validate_availability_options(db, None, config)  # no raise

    def test_valid_shift_ids_pass(self, db, td_user, td_tournament):
        shift = _make_shift(db, td_tournament)
        db.commit()
        config = {"options": [{"value": [shift.id], "label": shift.label}]}
        validate_availability_options(db, td_tournament.id, config)  # no raise

    def test_grouped_shift_ids_all_validated(self, db, td_user, td_tournament):
        s1 = _make_shift(db, td_tournament, "Morning")
        s2 = _make_shift(db, td_tournament, "Afternoon")
        db.commit()
        config = {"options": [{"value": [s1.id, s2.id], "label": "All Day"}]}
        validate_availability_options(db, td_tournament.id, config)  # no raise

    def test_shift_id_not_on_tournament_rejected(self, db, td_user, td_tournament, other_user, other_tournament):
        shift = _make_shift(db, other_tournament)
        db.commit()
        config = {"options": [{"value": [shift.id], "label": shift.label}]}
        with pytest.raises(FormFieldValidationError):
            validate_availability_options(db, td_tournament.id, config)

    def test_shift_from_another_day_rejected(self, db, td_user, td_tournament):
        """Availability write-through owns a whole day: a stray shift from a
        different date would be added by this question and removed by that
        day's own question, or the reverse, depending on submission order."""
        wrong_day = _make_shift(db, td_tournament, "Sunday", day=datetime(2026, 3, 16, tzinfo=timezone.utc))
        db.commit()
        config = {"options": [{"value": [wrong_day.id], "label": "Sunday"}]}
        with pytest.raises(FormFieldValidationError, match="outside this question's date"):
            validate_availability_options(db, td_tournament.id, config, date(2026, 3, 15))

    def test_shift_on_the_field_date_passes(self, db, td_user, td_tournament):
        shift = _make_shift(db, td_tournament, day=datetime(2026, 3, 15, 8, tzinfo=timezone.utc))
        db.commit()
        config = {"options": [{"value": [shift.id], "label": "Morning"}]}
        validate_availability_options(db, td_tournament.id, config, date(2026, 3, 15))  # no raise

    def test_date_check_skipped_when_no_field_date_given(self, db, td_user, td_tournament):
        shift = _make_shift(db, td_tournament, day=datetime(2026, 3, 16, tzinfo=timezone.utc))
        db.commit()
        config = {"options": [{"value": [shift.id], "label": "Whenever"}]}
        validate_availability_options(db, td_tournament.id, config)  # no raise

    def test_non_list_value_rejected(self, db, td_user, td_tournament):
        config = {"options": [{"value": "not_a_list", "label": "Whenever"}]}
        with pytest.raises(FormFieldValidationError):
            validate_availability_options(db, td_tournament.id, config)

    def test_empty_list_value_rejected(self, db, td_user, td_tournament):
        config = {"options": [{"value": [], "label": "Whenever"}]}
        with pytest.raises(FormFieldValidationError):
            validate_availability_options(db, td_tournament.id, config)


# ---------------------------------------------------------------------------
# validate_track_status_options
# ---------------------------------------------------------------------------

class TestOptionValueReaders:
    """option_track_assignments / option_shift_ids are the shared readers for
    an option's `value`, whose shape depends on the field_key. Getting the
    discrimination wrong is the bug they exist to prevent: a plain
    event_preference option's list[int] must not read as assignments, and an
    opted-in availability option's dict must not read as shift ids."""

    def test_assignments_as_the_value_itself(self):
        option = {"value": [{"id": 7, "status": "confirmed"}]}
        assert option_track_assignments(option) == [{"id": 7, "status": "confirmed"}]

    def test_assignments_nested_under_availability_value(self):
        option = {"value": {"shift_ids": [1, 2], "track_statuses": [{"id": 7, "status": "declined"}]}}
        assert option_track_assignments(option) == [{"id": 7, "status": "declined"}]

    def test_grouped_entity_ids_are_not_assignments(self):
        assert option_track_assignments({"value": [5, 9]}) == []

    def test_plain_text_value_has_no_assignments(self):
        assert option_track_assignments({"value": "vegetarian"}) == []

    def test_shift_ids_from_a_plain_availability_option(self):
        assert option_shift_ids({"value": [3, 2, 5]}) == [3, 2, 5]

    def test_shift_ids_from_an_opted_in_availability_option(self):
        option = {"value": {"shift_ids": [3, 2], "track_statuses": [{"id": 7, "status": "confirmed"}]}}
        assert option_shift_ids(option) == [3, 2]

    def test_missing_value_yields_nothing(self):
        assert option_shift_ids({}) == []
        assert option_track_assignments({}) == []


class TestValidateTrackStatusOptions:
    def _track(self, db, tournament):
        track = TournamentTrack(tournament_id=tournament.id, name="Test Writing")
        db.add(track)
        db.flush()
        return track

    # A track_status_* option carries its assignments *as* its value
    # (list[TrackStatusAssignment]); an opted-in availability option nests
    # them under a dict alongside shift_ids. Both shapes must match
    # schemas/form.py exactly — extra='forbid' rejects anything else, so a
    # test config that invents its own shape validates nothing.
    def _config(self, track_id, **overrides):
        config = {
            "required": True,
            "options": [{
                "option_id": "yes", "label": "Yes",
                "value": [{"id": track_id, "status": "interested"}],
            }],
        }
        config.update(overrides)
        return config

    def _availability_config(self, track_id, **overrides):
        config = {
            "required": True,
            "options": [{
                "option_id": "yes", "label": "Yes",
                "value": {"shift_ids": [1], "track_statuses": [{"id": track_id, "status": "interested"}]},
            }],
        }
        config.update(overrides)
        return config

    def test_track_status_accepts_tournament_track(self, db, td_user, td_tournament):
        track = self._track(db, td_tournament)
        config = self._config(track.id)
        validate_track_status_options(db, td_tournament.id, "track_status_interest", "single_select_radio", config)

    def test_track_status_requires_required_question(self, db, td_user, td_tournament):
        track = self._track(db, td_tournament)
        with pytest.raises(FormFieldValidationError, match="must be required"):
            validate_track_status_options(
                db, td_tournament.id, "track_status_interest", "single_select_radio",
                self._config(track.id, required=False),
            )

    def test_option_track_statuses_require_explicit_known_status(self):
        with pytest.raises(FormFieldValidationError):
            validate_field_config(
                "single_select_radio",
                {
                    "required": True,
                    "options": [{
                        "option_id": "opt_1", "label": "A",
                        "value": [{"id": 1, "status": "maybe"}],
                    }],
                },
            )

    def test_track_status_rejects_foreign_track(self, db, td_user, td_tournament, other_tournament):
        foreign = self._track(db, other_tournament)
        with pytest.raises(FormFieldValidationError, match="do not belong"):
            validate_track_status_options(
                db, td_tournament.id, "track_status_interest", "single_select_radio", self._config(foreign.id)
            )

    def test_availability_requires_opt_in_for_track_outcomes(self, db, td_user, td_tournament):
        track = self._track(db, td_tournament)
        config = self._availability_config(track.id)
        with pytest.raises(FormFieldValidationError, match="only allowed"):
            validate_track_status_options(
                db, td_tournament.id, "availability_20260315", "single_select_radio", config
            )

        config["track_status_enabled"] = True
        validate_track_status_options(db, td_tournament.id, "availability_20260315", "single_select_radio", config)

    def test_entity_ids_are_not_mistaken_for_track_assignments(self, db, td_user, td_tournament):
        """A list-valued option on a non-track field holds entity ids, not
        assignments — the "only allowed" guard must not fire on those."""
        config = {
            "required": True,
            "options": [{"option_id": "one", "label": "One", "value": [1, 2, 3]}],
        }
        validate_track_status_options(
            db, td_tournament.id, "event_preference_labs", "multi_select_checkbox", config
        )
        validate_track_status_options(
            db, td_tournament.id, "availability_20260315", "multi_select_checkbox", config
        )

    def test_checkbox_rejects_conflicting_track_statuses(self, db, td_user, td_tournament):
        track = self._track(db, td_tournament)
        config = self._config(track.id, options=[
            {"option_id": "one", "label": "One", "value": [{"id": track.id, "status": "interested"}]},
            {"option_id": "two", "label": "Two", "value": [{"id": track.id, "status": "declined"}]},
        ])
        with pytest.raises(FormFieldValidationError, match="conflicting statuses"):
            validate_track_status_options(db, td_tournament.id, "track_status_interest", "multi_select_checkbox", config)


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
            config={
                "required": False,
                "options": [{"option_id": "opt_1", "value": "yes", "label": "Yes", "next_field_id": 9999}],
            },
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
