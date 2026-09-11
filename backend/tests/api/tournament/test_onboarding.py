"""API coverage for tournament onboarding configuration and member progress."""

from tests.conftest import grant_role, login

from app.models.models import Form, FormField, FormResponse, TournamentForm, TournamentMembership


def _make_form(db, user, tournament, *, name="Onboarding form", status="published"):
    form = Form(
        owner_type="tournament",
        tournament_id=tournament.id,
        chapter_id=None,
        name=name,
        title=name,
        status=status,
        created_by=user.id,
    )
    db.add(form)
    db.flush()
    db.add(TournamentForm(form_id=form.id, tournament_id=tournament.id))
    db.flush()
    return form


def _onboarding_form_ids(db, tournament_id):
    return [
        row.form_id
        for row in (
            db.query(TournamentForm)
            .filter(TournamentForm.tournament_id == tournament_id, TournamentForm.is_onboarding == True)
            .order_by(TournamentForm.order)
            .all()
        )
    ]


def _as_steps(*forms):
    for order, form in enumerate(forms, start=1):
        form.tournament_form.is_onboarding = True
        form.tournament_form.order = order


def _answer(db, user, *forms):
    db.add_all([FormResponse(form_id=form.id, user_id=user.id) for form in forms])


def _membership(db, tournament_id, user_id):
    db.expire_all()
    return (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == tournament_id,
            TournamentMembership.user_id == user_id,
        )
        .one()
    )


def test_add_published_form_to_onboarding_appends_and_clears_completed_members(client, db, td_user, td_tournament, other_user):
    first = _make_form(db, td_user, td_tournament, name="First")
    second = _make_form(db, td_user, td_tournament, name="Second")
    member = grant_role(db, td_tournament, other_user, "Runner")
    member.onboarded_at = td_tournament.created_at
    db.commit()

    login(client, "td@test.com", "tdpass")
    first_response = client.post(
        f"/tournaments/{td_tournament.id}/onboarding-forms/", json={"form_id": first.id}
    )
    second_response = client.post(
        f"/tournaments/{td_tournament.id}/onboarding-forms/", json={"form_id": second.id}
    )

    assert first_response.status_code == 201
    assert first_response.json()["order"] == 1
    assert second_response.status_code == 201
    assert second_response.json()["order"] == 2
    assert _membership(db, td_tournament.id, other_user.id).onboarded_at is None


def test_add_keeps_members_who_already_answered_onboarded(client, db, td_user, td_tournament, other_user):
    """It was a standalone form first — an existing answer counts."""
    form = _make_form(db, td_user, td_tournament)
    member = grant_role(db, td_tournament, other_user, "Runner")
    member.onboarded_at = td_tournament.created_at
    _answer(db, other_user, form)
    db.commit()
    login(client, "td@test.com", "tdpass")

    client.post(f"/tournaments/{td_tournament.id}/onboarding-forms/", json={"form_id": form.id})

    assert _membership(db, td_tournament.id, other_user.id).onboarded_at == td_tournament.created_at


def test_add_draft_form_to_onboarding_is_rejected(client, db, td_user, td_tournament):
    draft = _make_form(db, td_user, td_tournament, status="draft")
    db.commit()
    login(client, "td@test.com", "tdpass")

    response = client.post(
        f"/tournaments/{td_tournament.id}/onboarding-forms/", json={"form_id": draft.id}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Only published forms can be added to onboarding"


def test_list_onboarding_forms_is_ordered_and_manage_forms_gated(client, db, td_user, td_tournament, other_user):
    first = _make_form(db, td_user, td_tournament, name="First")
    second = _make_form(db, td_user, td_tournament, name="Second")
    first.tournament_form.is_onboarding = True
    first.tournament_form.order = 2
    second.tournament_form.is_onboarding = True
    second.tournament_form.order = 1
    grant_role(db, td_tournament, other_user, "Runner")
    db.commit()

    login(client, "td@test.com", "tdpass")
    response = client.get(f"/tournaments/{td_tournament.id}/onboarding-forms/")
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [second.id, first.id]

    login(client, "other@test.com", "otherpass")
    assert client.get(f"/tournaments/{td_tournament.id}/onboarding-forms/").status_code == 403


def test_reorder_requires_each_form_once_and_a_contiguous_sequence(client, db, td_user, td_tournament):
    first = _make_form(db, td_user, td_tournament, name="First")
    second = _make_form(db, td_user, td_tournament, name="Second")
    for order, form in enumerate((first, second), start=1):
        form.tournament_form.is_onboarding = True
        form.tournament_form.order = order
    db.commit()
    login(client, "td@test.com", "tdpass")

    duplicate_order = client.patch(
        f"/tournaments/{td_tournament.id}/onboarding-forms/reorder/",
        json={"forms": [{"form_id": first.id, "order": 1}, {"form_id": second.id, "order": 1}]},
    )
    duplicate_id = client.patch(
        f"/tournaments/{td_tournament.id}/onboarding-forms/reorder/",
        json={"forms": [
            {"form_id": first.id, "order": 1},
            {"form_id": first.id, "order": 2},
            {"form_id": second.id, "order": 2},
        ]},
    )
    valid = client.patch(
        f"/tournaments/{td_tournament.id}/onboarding-forms/reorder/",
        json={"forms": [{"form_id": first.id, "order": 2}, {"form_id": second.id, "order": 1}]},
    )

    assert duplicate_order.status_code == 422
    assert duplicate_id.status_code == 422
    assert valid.status_code == 200
    assert _onboarding_form_ids(db, td_tournament.id) == [second.id, first.id]


def test_remove_from_onboarding_renumbers_without_unonboarding_members(client, db, td_user, td_tournament, other_user):
    first = _make_form(db, td_user, td_tournament, name="First")
    second = _make_form(db, td_user, td_tournament, name="Second")
    third = _make_form(db, td_user, td_tournament, name="Third")
    _as_steps(first, second, third)
    member = grant_role(db, td_tournament, other_user, "Runner")
    member.onboarded_at = td_tournament.created_at
    _answer(db, other_user, first, second, third)
    db.commit()
    login(client, "td@test.com", "tdpass")

    response = client.delete(f"/tournaments/{td_tournament.id}/onboarding-forms/{second.id}/")

    assert response.status_code == 204
    assert _onboarding_form_ids(db, td_tournament.id) == [first.id, third.id]
    assert first.tournament_form.order == 1
    assert third.tournament_form.order == 2
    # Original completion time kept, not re-stamped.
    assert _membership(db, td_tournament.id, other_user.id).onboarded_at == td_tournament.created_at


def test_remove_from_onboarding_completes_stragglers_immediately(client, db, td_user, td_tournament, other_user):
    first = _make_form(db, td_user, td_tournament, name="First")
    second = _make_form(db, td_user, td_tournament, name="Second")
    _as_steps(first, second)
    grant_role(db, td_tournament, other_user, "Runner")
    _answer(db, other_user, first)
    db.commit()
    login(client, "td@test.com", "tdpass")

    client.delete(f"/tournaments/{td_tournament.id}/onboarding-forms/{second.id}/")

    assert _membership(db, td_tournament.id, other_user.id).onboarded_at is not None


def test_onboarding_form_can_be_archived_but_not_deleted(client, db, td_user, td_tournament):
    """Archiving just skips the step; deleting would drop it from the sequence."""
    form = _make_form(db, td_user, td_tournament)
    _as_steps(form)
    db.commit()
    login(client, "td@test.com", "tdpass")

    archive = client.patch(f"/forms/{form.id}/", json={"status": "archived"})
    delete = client.delete(f"/forms/{form.id}/")

    assert archive.status_code == 200
    assert delete.status_code == 409


def test_skipping_a_step_onboards_stragglers_immediately(client, db, td_user, td_tournament, other_user):
    first = _make_form(db, td_user, td_tournament, name="First")
    second = _make_form(db, td_user, td_tournament, name="Second")
    _as_steps(first, second)
    grant_role(db, td_tournament, other_user, "Runner")
    _answer(db, other_user, first)
    db.commit()
    login(client, "td@test.com", "tdpass")

    client.patch(f"/forms/{second.id}/", json={"status": "archived"})

    assert _membership(db, td_tournament.id, other_user.id).onboarded_at is not None


def test_republishing_a_step_rechecks_existing_responses(client, db, td_user, td_tournament, other_user, admin_user):
    """Un-onboards whoever hasn't answered it; keeps whoever already has."""
    first = _make_form(db, td_user, td_tournament, name="First")
    second = _make_form(db, td_user, td_tournament, name="Second", status="draft")
    db.add(FormField(
        form_id=second.id, order=1, label="Color", question_type="single_select_dropdown",
        field_key="color", is_archived=False,
        config={"required": False, "options": [{"option_id": "opt_1", "value": "opt_1", "label": "Red"}]},
    ))
    _as_steps(first, second)
    for user in (other_user, admin_user):
        grant_role(db, td_tournament, user, "Runner").onboarded_at = td_tournament.created_at
    _answer(db, other_user, first)
    _answer(db, admin_user, first, second)
    db.commit()
    login(client, "td@test.com", "tdpass")

    assert client.patch(f"/forms/{second.id}/", json={"status": "published"}).status_code == 200

    assert _membership(db, td_tournament.id, other_user.id).onboarded_at is None
    assert _membership(db, td_tournament.id, admin_user.id).onboarded_at == td_tournament.created_at


def test_progress_returns_next_form_then_snapshots_completion(client, db, td_user, td_tournament, other_user):
    first = _make_form(db, td_user, td_tournament, name="First")
    second = _make_form(db, td_user, td_tournament, name="Second")
    for order, form in enumerate((first, second), start=1):
        form.tournament_form.is_onboarding = True
        form.tournament_form.order = order
    grant_role(db, td_tournament, other_user, "Runner")
    db.commit()
    login(client, "other@test.com", "otherpass")

    initial = client.post(f"/tournaments/{td_tournament.id}/onboarding/progress/")
    db.add(FormResponse(form_id=first.id, user_id=other_user.id))
    db.commit()
    after_first = client.post(f"/tournaments/{td_tournament.id}/onboarding/progress/")
    db.add(FormResponse(form_id=second.id, user_id=other_user.id))
    db.commit()
    complete = client.post(f"/tournaments/{td_tournament.id}/onboarding/progress/")

    assert initial.json() == {"next_form_id": first.id, "onboarded_at": None}
    assert after_first.json() == {"next_form_id": second.id, "onboarded_at": None}
    assert complete.json()["next_form_id"] is None
    assert complete.json()["onboarded_at"] is not None
    assert _membership(db, td_tournament.id, other_user.id).onboarded_at is not None


def test_progress_requires_membership(client, td_user, other_tournament):
    login(client, "td@test.com", "tdpass")

    response = client.post(f"/tournaments/{other_tournament.id}/onboarding/progress/")

    assert response.status_code == 404
