"""Tests for app/core/form/changes.py — what a field edit means for people
who already answered it. Pure functions over a field and its proposed next
state; no DB, no HTTP. See backend/form-edit-lifecycle.md for the rules."""
import pytest

from app.core.form import changes
from app.models.models import FormField


def _field(**overrides):
    """A live field to edit. Not persisted — classify_field_change only reads
    attributes."""
    defaults = dict(
        form_id="form1",
        order=1,
        label="Favorite color",
        description=None,
        question_type="single_select_radio",
        field_key="favorite_color",
        config={
            "required": False,
            "options": [
                {"option_id": "opt_red", "value": "red", "label": "Red"},
                {"option_id": "opt_blue", "value": "blue", "label": "Blue"},
            ],
        },
        is_archived=False,
    )
    defaults.update(overrides)
    return FormField(**defaults)


def _classify(field, **overrides):
    """Re-submit `field` unchanged except for the given overrides — so each
    test isolates one edit rather than restating the whole entry."""
    args = dict(
        new_question_type=field.question_type,
        new_field_key=field.field_key,
        new_config=field.config,
        new_label=field.label,
        new_description=field.description,
    )
    args.update(overrides)
    return changes.classify_field_change(field, **args)


class TestNoChange:
    def test_resubmitting_unchanged_field_raises_nothing(self):
        assert _classify(_field()) == set()


class TestQuestionType:
    @pytest.mark.parametrize("old,new", [
        ("short_text", "long_text"),
        ("long_text", "short_text"),
        ("single_select_radio", "single_select_dropdown"),
        ("single_select_dropdown", "single_select_radio"),
    ])
    def test_within_shape_class_is_presentational(self, old, new):
        """Both store the same answer shape, so every stored answer stays
        valid — nobody needs to re-answer."""
        field = _field(question_type=old)
        assert changes.QUESTION_TYPE_CHANGED not in _classify(field, new_question_type=new)

    @pytest.mark.parametrize("old,new", [
        ("single_select_radio", "multi_select_checkbox"),
        ("multi_select_checkbox", "ranked_choice"),
        ("short_text", "single_select_radio"),
        ("acknowledgment", "short_text"),
    ])
    def test_across_shape_classes_flags(self, old, new):
        field = _field(question_type=old)
        assert changes.QUESTION_TYPE_CHANGED in _classify(field, new_question_type=new)


class TestOptions:
    def test_added_option_flags(self):
        field = _field()
        config = {**field.config, "options": [
            *field.config["options"],
            {"option_id": "opt_green", "value": "green", "label": "Green"},
        ]}
        assert changes.OPTION_ADDED in _classify(field, new_config=config)

    def test_removed_option_flags_as_invalidated(self):
        field = _field()
        config = {**field.config, "options": field.config["options"][:1]}
        reasons = _classify(field, new_config=config)
        assert changes.OPTION_INVALIDATED in reasons
        assert changes.OPTION_ADDED not in reasons

    def test_archived_option_is_not_a_live_option(self):
        """An option archived by a previous save is already hidden from
        respondents, so its continued presence in storage isn't an addition."""
        field = _field(config={"required": False, "options": [
            {"option_id": "opt_red", "value": "red", "label": "Red"},
            {"option_id": "opt_old", "value": "old", "label": "Old", "is_archived": True},
        ]})
        assert _classify(field) == set()

    def test_reordering_options_raises_nothing(self):
        field = _field()
        config = {**field.config, "options": list(reversed(field.config["options"]))}
        assert _classify(field, new_config=config) == set()

    def test_option_value_edit_is_not_respondent_facing(self):
        """`value` is TD-facing text; `label` is what the respondent read."""
        field = _field()
        options = [{**field.config["options"][0], "value": "crimson"}, field.config["options"][1]]
        assert _classify(field, new_config={**field.config, "options": options}) == set()

    def test_option_label_edit_is_text_changed(self):
        field = _field()
        options = [{**field.config["options"][0], "label": "Crimson"}, field.config["options"][1]]
        assert _classify(field, new_config={**field.config, "options": options}) == {changes.TEXT_CHANGED}


class TestRequired:
    def test_becoming_required_flags(self):
        field = _field()
        assert changes.NOW_REQUIRED in _classify(field, new_config={**field.config, "required": True})

    def test_becoming_optional_does_not_flag(self):
        """A previously required answer is still a valid answer."""
        field = _field(config={"required": True, "options": []})
        assert _classify(field, new_config={"required": False, "options": []}) == set()


class TestFieldKey:
    def test_standard_to_preset_flags(self):
        field = _field(field_key="availability_question")
        assert changes.KEY_CHANGED in _classify(field, new_field_key="availability_7")

    def test_preset_to_standard_flags(self):
        field = _field(field_key="lunch_7_protein")
        assert changes.KEY_CHANGED in _classify(field, new_field_key="lunch_choice")

    def test_standard_rename_is_not_a_key_change(self):
        """A plain key is a display name — renaming it changes nothing about
        what was asked or where the answer goes."""
        field = _field(field_key="favorite_color")
        assert _classify(field, new_field_key="preferred_color") == set()

    def test_preset_to_different_preset_is_not_a_key_change(self):
        field = _field(field_key="availability_7")
        assert _classify(field, new_field_key="availability_8") == set()


class TestText:
    def test_label_edit_flags(self):
        assert _classify(_field(), new_label="What colour do you like?") == {changes.TEXT_CHANGED}

    def test_description_edit_flags(self):
        assert _classify(_field(), new_description="Pick one") == {changes.TEXT_CHANGED}


class TestResolveReasons:
    def test_mandatory_survives_an_explicit_no(self):
        reasons = {changes.QUESTION_TYPE_CHANGED, changes.OPTION_ADDED}
        assert changes.resolve_reasons(reasons, notify=False) == reasons

    def test_optional_dropped_when_declined(self):
        reasons = {changes.TEXT_CHANGED, changes.KEY_CHANGED}
        assert changes.resolve_reasons(reasons, notify=False) == set()

    def test_optional_kept_when_accepted(self):
        reasons = {changes.TEXT_CHANGED, changes.KEY_CHANGED}
        assert changes.resolve_reasons(reasons, notify=True) == reasons

    def test_defaults_apply_when_caller_is_silent(self):
        """key_changed defaults on — skipping it silently leaves those
        responders out of write-through, with nothing to notice. Wording
        changes default off."""
        reasons = {changes.TEXT_CHANGED, changes.KEY_CHANGED}
        assert changes.resolve_reasons(reasons, notify=None) == {changes.KEY_CHANGED}

    def test_mixed_keeps_mandatory_and_drops_declined_optional(self):
        reasons = {changes.NOW_REQUIRED, changes.TEXT_CHANGED}
        assert changes.resolve_reasons(reasons, notify=False) == {changes.NOW_REQUIRED}


class TestShapeChangeSubsumesOptionDiffs:
    def test_gaining_options_with_a_type_change_reports_only_the_type_change(self):
        """A text field has no options to diff against — "an option was
        added" would describe a consequence of the type change, not a
        separate thing for a respondent to review."""
        field = _field(question_type="short_text", config={"required": False, "max_length": 50})
        config = {"required": False, "options": [
            {"option_id": "opt_blue", "value": "blue", "label": "Blue"},
        ]}
        reasons = _classify(field, new_question_type="single_select_radio", new_config=config)
        assert reasons == {changes.QUESTION_TYPE_CHANGED}

    def test_option_diffs_still_report_within_a_shape_class(self):
        field = _field(question_type="single_select_radio")
        config = {**field.config, "options": [
            *field.config["options"],
            {"option_id": "opt_green", "value": "green", "label": "Green"},
        ]}
        reasons = _classify(field, new_question_type="single_select_dropdown", new_config=config)
        assert reasons == {changes.OPTION_ADDED}


class TestEntityRegrouping:
    """On an entity-backed preset, an option's `value` is the shift/event ids
    it groups — the substance of the question, not display text."""

    def _availability(self, groups):
        return _field(
            field_key="availability_7",
            question_type="multi_select_checkbox",
            config={"required": False, "options": [
                {"option_id": option_id, "value": list(value), "label": option_id.title()}
                for option_id, value in groups.items()
            ]},
        )

    def test_regrouping_shifts_flags(self):
        field = self._availability({"morning": [1, 2], "afternoon": [3]})
        config = {**field.config, "options": [
            {"option_id": "morning", "value": [2], "label": "Morning"},
            {"option_id": "afternoon", "value": [3], "label": "Afternoon"},
        ]}
        assert changes.OPTION_REGROUPED in _classify(field, new_config=config)

    def test_reordering_ids_within_an_option_is_not_a_change(self):
        field = self._availability({"morning": [1, 2]})
        config = {**field.config, "options": [
            {"option_id": "morning", "value": [2, 1], "label": "Morning"},
        ]}
        assert _classify(field, new_config=config) == set()

    def test_regrouping_is_mandatory(self):
        """A respondent's stored answer now commits them to shifts they never
        picked, so the TD can't opt out of asking."""
        assert changes.OPTION_REGROUPED in changes.MANDATORY_REASONS

    def test_plain_question_value_edit_stays_cosmetic(self):
        """Same edit shape on a non-preset key is just TD-facing text."""
        field = _field(field_key="favorite_color")
        options = [{**field.config["options"][0], "value": "crimson"}, field.config["options"][1]]
        assert _classify(field, new_config={**field.config, "options": options}) == set()
