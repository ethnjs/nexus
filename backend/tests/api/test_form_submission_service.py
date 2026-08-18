"""Tests for form submissions and write-through handling."""

import pytest
from unittest.mock import MagicMock

from app.models.models import Form, FormAnswer, FormField, FormResponse
from app.services import form_submission_service
from app.services.form_submission_service import submit_form


NON_WRITE_THROUGH_FIELD_TYPES = [
    ("short_text", "hello world"),
    ("paragraph", "a full paragraph of text"),
    ("single_select_radio", "option_a"),
    ("single_select_dropdown", "option_b"),
    ("multi_select", ["alpha", "beta"]),
    ("ranked_choice", ["first", "second", "third"]),
    ("grid", {"row_1": "yes", "row_2": "no"}),
    ("shift_select", ["morning", "evening"]),
]


def _make_form(db, user, tournament, name="Submission test form"):
    form = Form(
        owner_type="tournament",
        tournament_id=tournament.id,
        name=name,
        created_by=user.id,
    )
    db.add(form)
    db.flush()
    return form


def _make_field(db, form, *, field_key, question_type, order=1):
    field = FormField(
        form_id=form.id,
        order=order,
        label=field_key.replace("_", " ").title(),
        description=None,
        question_type=question_type,
        field_key=field_key,
        config={"options": []},
        required=False,
        is_archived=False,
    )
    db.add(field)
    db.flush()
    return field


class TestSubmitFormFreshSubmission:
    @pytest.mark.parametrize(("field_key", "value"), NON_WRITE_THROUGH_FIELD_TYPES)
    def test_submit_form_fresh_submission_for_every_non_write_through_field_type(
        self, db, td_user, td_tournament, field_key, value
    ):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key=field_key, question_type="string", order=1)

        response = submit_form(form, td_user, {field.id: value}, db)

        assert response.form_id == form.id
        assert response.user_id == td_user.id

        answer = db.query(FormAnswer).filter(
            FormAnswer.response_id == response.id,
            FormAnswer.field_id == field.id,
        ).one()
        assert answer.value == value


class TestSubmitFormResubmission:
    @pytest.mark.parametrize(("field_key", "new_value"), NON_WRITE_THROUGH_FIELD_TYPES)
    def test_submit_form_resubmission_overwrites_for_every_non_write_through_field_type(
        self, db, td_user, td_tournament, field_key, new_value
    ):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key=field_key, question_type="string", order=1)

        existing_response = FormResponse(form_id=form.id, user_id=td_user.id)
        db.add(existing_response)
        db.flush()

        old_value = "old-value"
        if isinstance(new_value, list):
            old_value = ["older", "value"]
        elif isinstance(new_value, dict):
            old_value = {"old": "value"}

        db.add(FormAnswer(response_id=existing_response.id, field_id=field.id, value=old_value))
        db.flush()

        response = submit_form(form, td_user, {field.id: new_value}, db)

        assert response.id == existing_response.id
        answer = db.query(FormAnswer).filter(
            FormAnswer.response_id == response.id,
            FormAnswer.field_id == field.id,
        ).one()
        assert answer.value == new_value


class TestSubmitFormWriteThroughStubs:
    def test_submit_form_calls_write_through_stubs_for_availability_and_lunch(
        self, monkeypatch, db, td_user, td_tournament
    ):
        form = _make_form(db, td_user, td_tournament)
        availability_field = _make_field(db, form, field_key="availability", question_type="grid", order=1)
        lunch_field = _make_field(db, form, field_key="lunch", question_type="string", order=2)

        availability_mock = MagicMock(side_effect=NotImplementedError("availability stub reached"))
        lunch_mock = MagicMock(side_effect=NotImplementedError("lunch stub reached"))

        monkeypatch.setattr(form_submission_service, "_write_through_availability", availability_mock)
        monkeypatch.setattr(form_submission_service, "_write_through_lunch", lunch_mock)

        with pytest.raises(NotImplementedError, match="availability stub reached"):
            submit_form(form, td_user, {availability_field.id: ["Mon 9-11"]}, db)
        availability_mock.assert_called_once()

        with pytest.raises(NotImplementedError, match="lunch stub reached"):
            submit_form(form, td_user, {lunch_field.id: "veggie"}, db)
        lunch_mock.assert_called_once()
