"""Tests for app/core/form/branching.py — the server-side replay of the
branching graph used to enforce `required` only on fields a respondent
could actually reach. Fields here are built directly (not through the DB)
since compute_reachable_field_ids/missing_required_field_keys are pure
functions over a field list + an answers dict."""
from app.core.form.branching import (
    compute_reachable_field_ids,
    duplicate_ranked_choice_field_keys,
    missing_required_field_keys,
)
from app.models.models import FormField


def _field(id, order, question_type="short_text", config=None, field_key=None):
    return FormField(
        id=id,
        form_id=1,
        order=order,
        label=f"Field {id}",
        question_type=question_type,
        field_key=field_key or f"field_{id}",
        config=config or {"required": False},
        is_archived=False,
    )


class TestComputeReachableFieldIds:
    def test_linear_form_all_reachable(self):
        fields = [_field(1, 1), _field(2, 2), _field(3, 3)]
        assert compute_reachable_field_ids(fields, {}) == {1, 2, 3}

    def test_empty_form(self):
        assert compute_reachable_field_ids([], {}) == set()

    def test_simple_branch_jumps_over_skipped_field(self):
        fields = [
            _field(
                1,
                1,
                question_type="single_select_radio",
                config={
                    "required": True,
                    "options": [
                        {"option_id": "opt_yes", "value": "yes", "label": "Yes", "next_field_id": 3},
                        {"option_id": "opt_no", "value": "no", "label": "No"},
                    ],
                },
            ),
            _field(2, 2),  # skipped when the answer is "yes"
            _field(3, 3),
        ]
        assert compute_reachable_field_ids(fields, {1: "opt_yes"}) == {1, 3}

    def test_branch_not_taken_falls_through_in_order(self):
        fields = [
            _field(
                1,
                1,
                question_type="single_select_radio",
                config={
                    "required": True,
                    "options": [
                        {"option_id": "opt_yes", "value": "yes", "label": "Yes", "next_field_id": 3},
                        {"option_id": "opt_no", "value": "no", "label": "No"},
                    ],
                },
            ),
            _field(2, 2),
            _field(3, 3),
        ]
        assert compute_reachable_field_ids(fields, {1: "opt_no"}) == {1, 2, 3}

    def test_unanswered_branching_field_falls_through(self):
        fields = [
            _field(
                1,
                1,
                question_type="single_select_radio",
                config={
                    "required": False,
                    "options": [{"option_id": "opt_yes", "value": "yes", "label": "Yes", "next_field_id": 3}],
                },
            ),
            _field(2, 2),
            _field(3, 3),
        ]
        assert compute_reachable_field_ids(fields, {}) == {1, 2, 3}

    def test_submit_form_action_ends_walk_early(self):
        fields = [
            _field(
                1,
                1,
                question_type="single_select_radio",
                config={
                    "required": True,
                    "options": [
                        {"option_id": "opt_no", "value": "no", "label": "No", "action": "submit_form"},
                    ],
                },
            ),
            _field(2, 2),
            _field(3, 3),
        ]
        assert compute_reachable_field_ids(fields, {1: "opt_no"}) == {1}

    def test_cycle_terminates_instead_of_hanging(self):
        fields = [
            _field(
                1,
                1,
                question_type="single_select_radio",
                config={
                    "required": False,
                    "options": [{"option_id": "opt_a", "value": "a", "label": "A", "next_field_id": 2}],
                },
            ),
            _field(
                2,
                2,
                question_type="single_select_radio",
                config={
                    "required": False,
                    "options": [{"option_id": "opt_b", "value": "b", "label": "B", "next_field_id": 1}],
                },
            ),
        ]
        assert compute_reachable_field_ids(fields, {1: "opt_a", 2: "opt_b"}) == {1, 2}


class TestMissingRequiredFieldKeys:
    def test_skipped_required_field_not_enforced(self):
        fields = [
            _field(
                1,
                1,
                question_type="single_select_radio",
                config={
                    "required": True,
                    "options": [
                        {"option_id": "opt_yes", "value": "yes", "label": "Yes", "next_field_id": 3},
                        {"option_id": "opt_no", "value": "no", "label": "No"},
                    ],
                },
            ),
            _field(2, 2, config={"required": True}),  # branched past — should NOT be enforced
            _field(3, 3, config={"required": False}),
        ]
        assert missing_required_field_keys(fields, {1: "opt_yes"}) == []

    def test_reachable_required_field_left_blank_is_reported(self):
        fields = [_field(1, 1, config={"required": True})]
        assert missing_required_field_keys(fields, {}) == ["field_1"]

    def test_answered_but_unreachable_field_not_reported(self):
        fields = [
            _field(
                1,
                1,
                question_type="single_select_radio",
                config={
                    "required": True,
                    "options": [{"option_id": "opt_no", "value": "no", "label": "No", "action": "submit_form"}],
                },
            ),
            _field(2, 2, config={"required": True}),
        ]
        # field 2 has an answer even though it was never reachable — not our
        # job to reject that here, just don't let it block the submission
        assert missing_required_field_keys(fields, {1: "opt_no", 2: "something"}) == []

    def test_blank_values_treated_as_unanswered(self):
        fields = [_field(1, 1, config={"required": True})]
        for blank in (None, "", [], {}, False):
            assert missing_required_field_keys(fields, {1: blank}) == ["field_1"]

    def test_non_blank_answer_satisfies_required(self):
        fields = [_field(1, 1, config={"required": True})]
        assert missing_required_field_keys(fields, {1: "hello"}) == []


class TestDuplicateRankedChoiceFieldKeys:
    def _ranked_field(self, id, allow_duplicates=False, field_key=None):
        return _field(
            id, 1, question_type="ranked_choice",
            config={"required": False, "ranks": 3, "allow_duplicates": allow_duplicates, "options": []},
            field_key=field_key,
        )

    def test_repeated_option_across_ranks_rejected_by_default(self):
        fields = [self._ranked_field(1)]
        assert duplicate_ranked_choice_field_keys(fields, {1: {"1": "opt_a", "2": "opt_b", "3": "opt_a"}}) == ["field_1"]

    def test_repeated_option_allowed_when_config_permits(self):
        fields = [self._ranked_field(1, allow_duplicates=True)]
        assert duplicate_ranked_choice_field_keys(fields, {1: {"1": "opt_a", "2": "opt_a"}}) == []

    def test_no_repeats_passes(self):
        fields = [self._ranked_field(1)]
        assert duplicate_ranked_choice_field_keys(fields, {1: {"1": "opt_a", "2": "opt_b"}}) == []

    def test_non_ranked_choice_fields_untouched(self):
        fields = [_field(1, 1, question_type="multi_select_checkbox", config={"required": False})]
        assert duplicate_ranked_choice_field_keys(fields, {1: ["opt_a", "opt_a"]}) == []

    def test_unanswered_ranked_field_not_reported(self):
        fields = [self._ranked_field(1)]
        assert duplicate_ranked_choice_field_keys(fields, {}) == []

    def test_multiple_offending_fields_all_reported(self):
        fields = [self._ranked_field(1, field_key="field_1"), self._ranked_field(2, field_key="field_2")]
        answers = {1: {"1": "opt_a", "2": "opt_a"}, 2: {"1": "opt_b", "2": "opt_b"}}
        assert duplicate_ranked_choice_field_keys(fields, answers) == ["field_1", "field_2"]
