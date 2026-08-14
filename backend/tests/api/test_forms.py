from app.core.form import remove_form_field, remove_option_from_field, replace_field_type
from app.models.models import Form, FormAnswer, FormField, FormResponse


def _make_form(db, user, tournament, name="Test form"):
    form = Form(
        owner_type="tournament",
        tournament_id=tournament.id,
        name=name,
        created_by=user.id,
    )
    db.add(form)
    db.flush()
    return form


def _make_field(db, form, *, order=1, field_key="favorite_color", question_type="single_select_dropdown"):
    field = FormField(
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
        required=False,
        is_archived=False,
    )
    db.add(field)
    db.flush()
    return field


def test_remove_form_field_archives_when_answers_exist(db, td_user, td_tournament):
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
    assert db.query(FormField).filter(FormField.id == field.id).one().is_archived is True
    assert db.query(FormAnswer).filter(FormAnswer.field_id == field.id).one().value == ["opt_1"]


def test_replace_field_type_archives_old_field_and_keeps_order(db, td_user, td_tournament):
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

    ordered_fields = db.query(FormField).filter(FormField.form_id == form.id).order_by(FormField.order).all()
    assert [f.id for f in ordered_fields] == [replacement.id, field.id]
    assert replacement.order == 7
    assert field.order == 7


def test_remove_option_from_field_keeps_existing_answer_values(db, td_user, td_tournament):
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
    assert updated.config["options"][0]["label"] == "Red"
    assert db.query(FormAnswer).filter(FormAnswer.field_id == field.id).one().value == ["opt_1"]
