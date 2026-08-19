"""Tests for app/core/form/branching.py — the server-side replay of the
branching graph used to enforce `required` only on fields a respondent
could actually reach. Fields here are built directly (not through the DB)
since compute_reachable_field_ids/missing_required_field_keys are pure
functions over a field list + an answers dict."""
from app.core.form.branching import compute_reachable_field_ids, missing_required_field_keys
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
                        {"value": "yes", "label": "Yes", "next_field_id": 3},
                        {"value": "no", "label": "No"},
                    ],
                },
            ),
            _field(2, 2),  # skipped when the answer is "yes"
            _field(3, 3),
        ]
        assert compute_reachable_field_ids(fields, {1: "yes"}) == {1, 3}

    def test_branch_not_taken_falls_through_in_order(self):
        fields = [
            _field(
                1,
                1,
                question_type="single_select_radio",
                config={
                    "required": True,
                    "options": [
                        {"value": "yes", "label": "Yes", "next_field_id": 3},
                        {"value": "no", "label": "No"},
                    ],
                },
            ),
            _field(2, 2),
            _field(3, 3),
        ]
        assert compute_reachable_field_ids(fields, {1: "no"}) == {1, 2, 3}

    def test_unanswered_branching_field_falls_through(self):
        fields = [
            _field(
                1,
                1,
                question_type="single_select_radio",
                config={"required": False, "options": [{"value": "yes", "label": "Yes", "next_field_id": 3}]},
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
                        {"value": "no", "label": "No", "action": "submit_form"},
                    ],
                },
            ),
            _field(2, 2),
            _field(3, 3),
        ]
        assert compute_reachable_field_ids(fields, {1: "no"}) == {1}

    def test_cycle_terminates_instead_of_hanging(self):
        fields = [
            _field(
                1,
                1,
                question_type="single_select_radio",
                config={"required": False, "options": [{"value": "a", "label": "A", "next_field_id": 2}]},
            ),
            _field(
                2,
                2,
                question_type="single_select_radio",
                config={"required": False, "options": [{"value": "b", "label": "B", "next_field_id": 1}]},
            ),
        ]
        assert compute_reachable_field_ids(fields, {1: "a", 2: "b"}) == {1, 2}


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
                        {"value": "yes", "label": "Yes", "next_field_id": 3},
                        {"value": "no", "label": "No"},
                    ],
                },
            ),
            _field(2, 2, config={"required": True}),  # branched past — should NOT be enforced
            _field(3, 3, config={"required": False}),
        ]
        assert missing_required_field_keys(fields, {1: "yes"}) == []

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
                    "options": [{"value": "no", "label": "No", "action": "submit_form"}],
                },
            ),
            _field(2, 2, config={"required": True}),
        ]
        # field 2 has an answer even though it was never reachable — not our
        # job to reject that here, just don't let it block the submission
        assert missing_required_field_keys(fields, {1: "no", 2: "something"}) == []

    def test_blank_values_treated_as_unanswered(self):
        fields = [_field(1, 1, config={"required": True})]
        for blank in (None, "", [], {}, False):
            assert missing_required_field_keys(fields, {1: blank}) == ["field_1"]

    def test_non_blank_answer_satisfies_required(self):
        fields = [_field(1, 1, config={"required": True})]
        assert missing_required_field_keys(fields, {1: "hello"}) == []
