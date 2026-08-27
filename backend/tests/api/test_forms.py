"""Route tests for /forms/ (app/api/routes/forms.py). Model CRUD, field
helpers, slugify/uniqueness, and the access-control dependency functions are
covered directly in tests/core/test_forms.py — this file exercises the HTTP
layer on top."""
from datetime import date, datetime, timedelta, timezone

import pytest

from tests.conftest import grant_role, login
from tests.api.chapter._helpers import make_chapter, make_university, make_user

from app.models.models import (
    ChapterMembership,
    Form,
    FormAnswer,
    FormField,
    FormResponse,
    FormResponsePendingUpdate,
    TournamentMembership,
    TournamentMembershipAvailability,
    TournamentMembershipLunch,
    TournamentForm,
    TournamentRole,
    TournamentShift,
    TournamentTrack,
    utcnow,
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


@pytest.fixture(name="chapter")
def chapter_fixture(db):
    university = make_university(db)
    return make_chapter(db, university.id)


def _chapter_lead(db, chapter, email="chapterlead@test.com", password="LeadPass123!"):
    user = make_user(db, email, password=password)
    db.add(ChapterMembership(chapter_id=chapter.id, user_id=user.id, role="lead"))
    db.commit()
    return user


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/forms/ and POST /chapters/{chapter_id}/forms/
# ---------------------------------------------------------------------------

class TestCreateForm:
    def test_td_can_create_tournament_form(self, client, td_user, td_tournament):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/tournaments/{td_tournament.id}/forms/",
            json={"name": "Interest form", "owner_type": "tournament", "tournament_id": td_tournament.id},
        )
        assert res.status_code == 201
        data = res.json()
        assert data["owner_type"] == "tournament"
        assert data["tournament_id"] == td_tournament.id
        assert data["status"] == "draft"

    def test_non_member_forbidden_via_404(self, client, other_user, td_tournament):
        login(client, "other@test.com", "otherpass")
        res = client.post(
            f"/tournaments/{td_tournament.id}/forms/",
            json={"name": "Interest form", "owner_type": "tournament", "tournament_id": td_tournament.id},
        )
        assert res.status_code == 404

    def test_member_without_manage_forms_forbidden(self, client, db, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Runner")
        login(client, "other@test.com", "otherpass")
        res = client.post(
            f"/tournaments/{td_tournament.id}/forms/",
            json={"name": "Interest form", "owner_type": "tournament", "tournament_id": td_tournament.id},
        )
        assert res.status_code == 403

    def test_owner_type_mismatch_rejected(self, client, td_user, td_tournament):
        login(client, "td@test.com", "tdpass")
        res = client.post(
            f"/tournaments/{td_tournament.id}/forms/",
            json={"name": "Bad", "owner_type": "chapter", "chapter_id": 1},
        )
        assert res.status_code == 422

    def test_chapter_lead_can_create_chapter_form(self, client, db, chapter):
        _chapter_lead(db, chapter)
        login(client, "chapterlead@test.com", "LeadPass123!")
        res = client.post(
            f"/chapters/{chapter.id}/forms/",
            json={"name": "Alumni form", "owner_type": "chapter", "chapter_id": chapter.id},
        )
        assert res.status_code == 201
        assert res.json()["owner_type"] == "chapter"
        assert res.json()["chapter_id"] == chapter.id

    def test_chapter_plain_member_forbidden(self, client, db, chapter):
        member = make_user(db, "plainmember@test.com", password="MemberPass123!")
        db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
        db.commit()
        login(client, "plainmember@test.com", "MemberPass123!")
        res = client.post(
            f"/chapters/{chapter.id}/forms/",
            json={"name": "Alumni form", "owner_type": "chapter", "chapter_id": chapter.id},
        )
        assert res.status_code == 403

    def test_unauthenticated_forbidden(self, client, td_tournament):
        res = client.post(
            f"/tournaments/{td_tournament.id}/forms/",
            json={"name": "Interest form", "owner_type": "tournament", "tournament_id": td_tournament.id},
        )
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/forms/ and GET /chapters/{chapter_id}/forms/
# ---------------------------------------------------------------------------

class TestListForms:
    def test_manager_lists_tournament_forms(self, client, db, td_user, td_tournament):
        _make_form(db, td_user, td_tournament, name="First")
        _make_form(db, td_user, td_tournament, name="Second")
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/tournaments/{td_tournament.id}/forms/")
        assert res.status_code == 200
        names = {f["name"] for f in res.json()}
        assert names == {"First", "Second"}

    def test_list_excludes_other_tournaments_and_chapter_forms(self, client, db, td_user, td_tournament, chapter):
        _make_form(db, td_user, td_tournament, name="Mine")
        _make_chapter_form(db, td_user, chapter, name="Not mine")
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/tournaments/{td_tournament.id}/forms/")
        assert res.status_code == 200
        names = [f["name"] for f in res.json()]
        assert names == ["Mine"]

    def test_member_without_manage_forms_forbidden(self, client, db, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Runner")
        login(client, "other@test.com", "otherpass")
        res = client.get(f"/tournaments/{td_tournament.id}/forms/")
        assert res.status_code == 403

    def test_chapter_lead_lists_chapter_forms(self, client, db, chapter, td_user):
        lead = _chapter_lead(db, chapter)
        _make_chapter_form(db, lead, chapter, name="Alumni interest")
        db.commit()
        login(client, "chapterlead@test.com", "LeadPass123!")
        res = client.get(f"/chapters/{chapter.id}/forms/")
        assert res.status_code == 200
        assert [f["name"] for f in res.json()] == ["Alumni interest"]

    def test_chapter_plain_member_forbidden(self, client, db, chapter):
        member = make_user(db, "plainmember@test.com", password="MemberPass123!")
        db.add(ChapterMembership(chapter_id=chapter.id, user_id=member.id, role="member"))
        db.commit()
        login(client, "plainmember@test.com", "MemberPass123!")
        res = client.get(f"/chapters/{chapter.id}/forms/")
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/forms/field-keys/
# ---------------------------------------------------------------------------

class TestListTournamentFieldKeys:
    def test_lists_distinct_keys_across_forms_including_archived(self, client, db, td_user, td_tournament):
        form_a = _make_form(db, td_user, td_tournament, name="A")
        form_b = _make_form(db, td_user, td_tournament, name="B")
        _make_field(db, form_a, field_key="favorite_color")
        _make_field(db, form_a, order=2, field_key="shirt_size")
        _make_field(db, form_b, field_key="favorite_color")
        _make_field(db, form_b, order=2, field_key="archived_key", is_archived=True)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/tournaments/{td_tournament.id}/forms/field-keys/")
        assert res.status_code == 200
        assert set(res.json()) == {"favorite_color", "shirt_size", "archived_key"}

    def test_excludes_chapter_forms(self, client, db, td_user, td_tournament, chapter):
        form_a = _make_form(db, td_user, td_tournament, name="A")
        _make_field(db, form_a, field_key="favorite_color")
        chapter_form = _make_chapter_form(db, td_user, chapter, name="Chapter form")
        _make_field(db, chapter_form, field_key="alumni_only_key")
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/tournaments/{td_tournament.id}/forms/field-keys/")
        assert res.status_code == 200
        assert set(res.json()) == {"favorite_color"}

    def test_member_without_manage_forms_forbidden(self, client, db, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Runner")
        login(client, "other@test.com", "otherpass")
        res = client.get(f"/tournaments/{td_tournament.id}/forms/field-keys/")
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/forms/{form_id}/prerequisites/
# ---------------------------------------------------------------------------

class TestTournamentFormPrerequisites:
    def _link(self, db, form, tournament, **overrides):
        row = TournamentForm(form_id=form.id, tournament_id=tournament.id, **overrides)
        db.add(row)
        db.commit()
        return row

    def test_manager_replaces_prerequisites_and_response_includes_them(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        role = db.query(TournamentRole).filter(TournamentRole.tournament_id == td_tournament.id).first()
        now = datetime.now(timezone.utc)
        shift = TournamentShift(tournament_id=td_tournament.id, label="Morning", start=now, end=now + timedelta(hours=2))
        db.add(shift)
        db.commit()
        self._link(db, form, td_tournament)
        login(client, "td@test.com", "tdpass")

        payload = {
            "onboarding_complete": True,
            "roles": {"ids": [role.id], "match": "all"},
            "availability": {"shift_ids": [shift.id], "match": "any"},
        }
        res = client.patch(f"/tournaments/{td_tournament.id}/forms/{form.id}/prerequisites/", json=payload)

        assert res.status_code == 200
        assert res.json()["prerequisites"] == payload
        listed = client.get(f"/tournaments/{td_tournament.id}/forms/")
        assert listed.status_code == 200
        assert listed.json()[0]["prerequisites"] == payload

    def test_rejects_role_or_shift_from_another_tournament(self, client, db, td_user, td_tournament, other_tournament):
        form = _make_form(db, td_user, td_tournament)
        self._link(db, form, td_tournament)
        other_role = db.query(TournamentRole).filter(TournamentRole.tournament_id == other_tournament.id).first()
        now = datetime.now(timezone.utc)
        other_shift = TournamentShift(tournament_id=other_tournament.id, label="Other", start=now, end=now + timedelta(hours=2))
        db.add(other_shift)
        db.commit()
        login(client, "td@test.com", "tdpass")

        role_res = client.patch(
            f"/tournaments/{td_tournament.id}/forms/{form.id}/prerequisites/",
            json={"roles": {"ids": [other_role.id], "match": "any"}},
        )
        shift_res = client.patch(
            f"/tournaments/{td_tournament.id}/forms/{form.id}/prerequisites/",
            json={"availability": {"shift_ids": [other_shift.id], "match": "all"}},
        )

        assert role_res.status_code == 422
        assert shift_res.status_code == 422

    def test_rejects_onboarding_form_and_member_without_manage_forms(self, client, db, td_user, td_tournament, other_user):
        form = _make_form(db, td_user, td_tournament)
        self._link(db, form, td_tournament, is_onboarding=True, order=1)
        login(client, "td@test.com", "tdpass")
        assert client.patch(
            f"/tournaments/{td_tournament.id}/forms/{form.id}/prerequisites/",
            json={"onboarding_complete": True},
        ).status_code == 409

        db.query(TournamentForm).filter(TournamentForm.form_id == form.id).update({TournamentForm.is_onboarding: False, TournamentForm.order: None})
        db.commit()
        grant_role(db, td_tournament, other_user, "Runner")
        login(client, "other@test.com", "otherpass")
        assert client.patch(
            f"/tournaments/{td_tournament.id}/forms/{form.id}/prerequisites/",
            json={"onboarding_complete": True},
        ).status_code == 403


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/forms/me/
# ---------------------------------------------------------------------------

class TestMyTournamentForms:
    def _form(self, db, user, tournament, *, status="published", is_onboarding=False, order=None, prerequisites=None):
        form = _make_form(db, user, tournament, status=status)
        db.add(TournamentForm(
            form_id=form.id,
            tournament_id=tournament.id,
            is_onboarding=is_onboarding,
            order=order,
            prerequisites=prerequisites or {},
        ))
        db.commit()
        return form

    def test_lists_completed_history_and_currently_eligible_forms(self, client, db, td_user, td_tournament, other_user):
        membership = grant_role(db, td_tournament, other_user, "Runner")
        completed_archived = self._form(db, td_user, td_tournament, status="archived")
        eligible_standard = self._form(db, td_user, td_tournament)
        blocked_standard = self._form(db, td_user, td_tournament, prerequisites={"onboarding_complete": True})
        completed_onboarding = self._form(db, td_user, td_tournament, is_onboarding=True, order=1)
        next_onboarding = self._form(db, td_user, td_tournament, is_onboarding=True, order=2)
        db.add_all([
            FormResponse(form_id=completed_archived.id, user_id=other_user.id),
            FormResponse(form_id=completed_onboarding.id, user_id=other_user.id),
        ])
        db.commit()
        login(client, "other@test.com", "otherpass")

        res = client.get(f"/tournaments/{td_tournament.id}/forms/me/")

        assert res.status_code == 200
        rows = {row["id"]: row for row in res.json()}
        assert set(rows) == {completed_archived.id, eligible_standard.id, completed_onboarding.id, next_onboarding.id}
        assert rows[completed_archived.id]["completed"] is True
        assert rows[completed_archived.id]["eligible"] is False
        assert rows[eligible_standard.id]["eligible"] is True
        assert rows[completed_onboarding.id]["is_onboarding"] is True
        assert rows[next_onboarding.id]["eligible"] is True
        assert blocked_standard.id not in rows
        assert membership.onboarded_at is None

    def test_requires_a_tournament_membership(self, client, td_user, td_tournament, other_user):
        login(client, "other@test.com", "otherpass")

        assert client.get(f"/tournaments/{td_tournament.id}/forms/me/").status_code == 404


# ---------------------------------------------------------------------------
# GET /forms/{form_id}/
# ---------------------------------------------------------------------------

class TestGetForm:
    def test_manager_can_view(self, client, td_user, td_tournament, db):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/forms/{form.id}/")
        assert res.status_code == 200
        assert res.json()["id"] == form.id

    def test_plain_member_can_view(self, client, db, td_user, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Runner")
        form = _make_form(db, td_user, td_tournament, status="published")
        db.add(TournamentForm(form_id=form.id, tournament_id=td_tournament.id))
        db.commit()
        login(client, "other@test.com", "otherpass")
        res = client.get(f"/forms/{form.id}/")
        assert res.status_code == 200

    def test_non_member_forbidden(self, client, db, td_user, td_tournament, other_user):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "other@test.com", "otherpass")
        res = client.get(f"/forms/{form.id}/")
        assert res.status_code == 403

    def test_missing_form_404(self, client, td_user):
        login(client, "td@test.com", "tdpass")
        res = client.get("/forms/9999/")
        assert res.status_code == 404

    def test_includes_active_fields_ordered(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        _make_field(db, form, order=2, field_key="second")
        _make_field(db, form, order=1, field_key="first")
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/forms/{form.id}/")
        keys = [f["field_key"] for f in res.json()["fields"]]
        assert keys == ["first", "second"]


# ---------------------------------------------------------------------------
# PATCH / delete /forms/{form_id}/
# ---------------------------------------------------------------------------

class TestUpdateArchiveDeleteForm:
    def test_patch_updates_fields(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        _make_field(db, form)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(f"/forms/{form.id}/", json={"name": "Renamed", "status": "published"})
        assert res.status_code == 200
        assert res.json()["name"] == "Renamed"
        assert res.json()["status"] == "published"

    def test_patch_archives_form(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.patch(f"/forms/{form.id}/", json={"status": "archived"})
        assert res.status_code == 200
        assert res.json()["status"] == "archived"

    def test_member_cannot_view_standard_form_without_prerequisites(self, client, db, td_user, td_tournament, other_user):
        membership = grant_role(db, td_tournament, other_user, "Runner")
        form = _make_form(db, td_user, td_tournament, status="published")
        db.add(TournamentForm(
            form_id=form.id,
            tournament_id=td_tournament.id,
            prerequisites={"onboarding_complete": True},
        ))
        db.commit()
        login(client, "other@test.com", "otherpass")

        assert client.get(f"/forms/{form.id}/").status_code == 403
        assert client.post(f"/forms/{form.id}/responses/", json={"answers": []}).status_code == 403
        membership.onboarded_at = utcnow()
        db.commit()
        assert client.get(f"/forms/{form.id}/").status_code == 200

    def test_patch_restores_archived_form_to_draft(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="archived")
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.patch(f"/forms/{form.id}/", json={"status": "draft"})

        assert res.status_code == 200
        assert res.json()["status"] == "draft"

    def test_unpublish_published_form_to_draft(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="published")
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.patch(f"/forms/{form.id}/", json={"status": "draft"})

        assert res.status_code == 200
        assert res.json()["status"] == "draft"

    def test_delete_succeeds_with_no_responses(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.delete(f"/forms/{form.id}/")
        assert res.status_code == 204
        assert db.query(Form).filter(Form.id == form.id).first() is None

    def test_delete_blocked_when_responses_exist(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.add(FormResponse(form_id=form.id, user_id=td_user.id))
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.delete(f"/forms/{form.id}/")
        assert res.status_code == 409
        assert db.query(Form).filter(Form.id == form.id).first() is not None


# ---------------------------------------------------------------------------
# PUT /forms/{form_id}/fields/ — bulk field replace (Edit Lifecycle)
# ---------------------------------------------------------------------------

def _simple_entry(**overrides):
    entry = {
        "field_key": "color",
        "label": "Favorite color",
        "question_type": "short_text",
        "config": {"required": False, "max_length": 100},
    }
    entry.update(overrides)
    return entry


class TestBulkUpdateFieldsDraft:
    def test_create_update_delete_apply_directly(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)  # draft by default
        existing = _make_field(db, form, field_key="to_delete", question_type="short_text", config={"required": False, "max_length": 50})
        keep = _make_field(db, form, field_key="to_update", question_type="short_text", config={"required": False, "max_length": 50})
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.put(
            f"/forms/{form.id}/fields/",
            json={
                "fields": [
                    {"id": keep.id, "label": "Updated label", "question_type": "short_text", "config": {"required": False, "max_length": 200}},
                    _simple_entry(field_key="brand_new"),
                ]
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert {f["field_key"] for f in data} == {"to_update", "brand_new"}

        assert db.query(FormField).filter(FormField.id == existing.id).first() is None  # hard-deleted
        db.refresh(keep)
        assert keep.label == "Updated label"
        assert keep.config["max_length"] == 200

    def test_question_type_change_applies_in_place_no_replacement(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color", question_type="short_text", config={"required": False, "max_length": 50})
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.put(
            f"/forms/{form.id}/fields/",
            json={"fields": [{"id": field.id, "label": "Color", "question_type": "long_text", "config": {"required": False, "max_length": 500}}]},
        )
        assert res.status_code == 200
        assert res.json()[0]["id"] == field.id
        assert res.json()[0]["question_type"] == "long_text"
        assert db.query(FormField).filter(FormField.form_id == form.id).count() == 1


class TestBulkUpdateFieldsPublished:
    def _publish(self, client, form):
        return client.patch(f"/forms/{form.id}/", json={"status": "published"})

    def test_label_only_edit_applies_in_place(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color", question_type="short_text", config={"required": False, "max_length": 50})
        db.commit()
        login(client, "td@test.com", "tdpass")
        self._publish(client, form)

        res = client.put(
            f"/forms/{form.id}/fields/",
            json={"fields": [{"id": field.id, "label": "New label", "question_type": "short_text", "config": {"required": False, "max_length": 50}}]},
        )
        assert res.status_code == 200
        assert res.json()[0]["id"] == field.id
        assert res.json()[0]["label"] == "New label"

    def test_question_type_change_archives_and_replaces_same_key(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, order=1, field_key="color", question_type="short_text", config={"required": False, "max_length": 50})
        db.commit()
        login(client, "td@test.com", "tdpass")
        self._publish(client, form)

        res = client.put(
            f"/forms/{form.id}/fields/",
            json={"fields": [{"id": field.id, "label": "Color", "question_type": "long_text", "config": {"required": False, "max_length": 500}}]},
        )
        assert res.status_code == 200
        data = res.json()
        assert len(data) == 1
        assert data[0]["id"] != field.id
        assert data[0]["field_key"] == "color"
        assert data[0]["question_type"] == "long_text"

        db.refresh(field)
        assert field.is_archived is True
        assert field.field_key != "color"

    def test_submitted_field_key_wins_over_inheritance_on_replacement(self, client, db, td_user, td_tournament):
        """Applying a preset renames the field_key *and* changes the
        question_type in one save. The replacement normally inherits the old
        key, but here that would validate the new track_status config against
        the pre-preset key and 422."""
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, order=1, field_key="interest", question_type="short_text", config={"required": False, "max_length": 50})
        track = TournamentTrack(tournament_id=td_tournament.id, name="Test Writing")
        db.add(track)
        db.commit()
        login(client, "td@test.com", "tdpass")
        self._publish(client, form)

        res = client.put(
            f"/forms/{form.id}/fields/",
            json={"fields": [{
                "id": field.id,
                "field_key": "track_status_volunteer_interest",
                "label": "Interested?",
                "question_type": "single_select_radio",
                "config": {"required": True, "options": [
                    {"option_id": "yes", "label": "Yes", "value": [{"id": track.id, "status": "interested"}]},
                    {"option_id": "no", "label": "No", "value": []},
                ]},
            }]},
        )
        assert res.status_code == 200, res.json()
        assert res.json()[0]["field_key"] == "track_status_volunteer_interest"

    def test_field_key_rename_applies_in_place(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color", question_type="short_text", config={"required": False, "max_length": 50})
        db.commit()
        login(client, "td@test.com", "tdpass")
        self._publish(client, form)

        res = client.put(
            f"/forms/{form.id}/fields/",
            json={"fields": [{"id": field.id, "field_key": "favorite_color", "label": "Color", "question_type": "short_text", "config": {"required": False, "max_length": 50}}]},
        )
        assert res.status_code == 200, res.json()
        assert res.json()[0]["id"] == field.id
        assert res.json()[0]["field_key"] == "favorite_color"

    def test_removed_field_archives_not_deletes(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color", question_type="short_text", config={"required": False, "max_length": 50})
        db.commit()
        login(client, "td@test.com", "tdpass")
        self._publish(client, form)

        res = client.put(f"/forms/{form.id}/fields/", json={"fields": []})
        assert res.status_code == 200
        assert res.json() == []

        db.refresh(field)
        assert field.is_archived is True
        assert db.query(FormField).filter(FormField.id == field.id).first() is not None

    def test_unpublished_form_with_responses_preserves_removed_field(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color", question_type="short_text", config={"required": False, "max_length": 50})
        db.commit()
        login(client, "td@test.com", "tdpass")
        self._publish(client, form)
        assert client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": "blue"}]}).status_code == 200

        assert client.patch(f"/forms/{form.id}/", json={"status": "draft"}).status_code == 200
        res = client.put(f"/forms/{form.id}/fields/", json={"fields": []})

        assert res.status_code == 200
        db.refresh(field)
        assert field.is_archived is True
        assert db.query(FormField).filter(FormField.id == field.id).first() is not None

    def test_new_entry_inserts(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color", question_type="short_text", config={"required": False, "max_length": 50})
        db.commit()
        login(client, "td@test.com", "tdpass")
        self._publish(client, form)

        res = client.put(
            f"/forms/{form.id}/fields/",
            json={
                "fields": [
                    {"id": field.id, "label": "Favorite color", "question_type": "short_text", "config": {"required": False, "max_length": 50}},
                    _simple_entry(field_key="brand_new"),
                ]
            },
        )
        assert res.status_code == 200
        assert {f["field_key"] for f in res.json()} == {"color", "brand_new"}

    def test_whole_batch_rejected_together_on_dangling_next_field_id(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        branch_field = _make_field(
            db, form, field_key="branch", question_type="single_select_radio",
            config={
                "required": False,
                "options": [{"option_id": "opt_yes", "value": "yes", "label": "Yes", "next_field_id": 9999}],
            },
        )
        other_field = _make_field(db, form, order=2, field_key="other", question_type="short_text", config={"required": False, "max_length": 50})
        db.commit()
        login(client, "td@test.com", "tdpass")
        self._publish(client, form)

        res = client.put(
            f"/forms/{form.id}/fields/",
            json={
                "fields": [
                    {
                        "id": branch_field.id, "label": "Branch", "question_type": "single_select_radio",
                        "config": {
                            "required": False,
                            "options": [{"option_id": "opt_yes", "value": "yes", "label": "Yes", "next_field_id": 9999}],
                        },
                    },
                    {"id": other_field.id, "label": "New label that should not stick", "question_type": "short_text", "config": {"required": False, "max_length": 50}},
                ]
            },
        )
        assert res.status_code == 422

        db.refresh(other_field)
        assert other_field.label != "New label that should not stick"

    def test_option_removed_archives_not_dropped(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(
            db, form, field_key="color", question_type="multi_select_checkbox",
            config={
                "required": False,
                "options": [
                    {"option_id": "opt_red", "value": "red", "label": "Red"},
                    {"option_id": "opt_blue", "value": "blue", "label": "Blue"},
                ],
            },
        )
        db.commit()
        login(client, "td@test.com", "tdpass")
        self._publish(client, form)

        # A response answers with the option we're about to remove.
        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_red"]}]})
        assert res.status_code == 200
        response_id = res.json()["id"]

        res = client.put(
            f"/forms/{form.id}/fields/",
            json={
                "fields": [
                    {
                        "id": field.id, "label": "Favorite color", "question_type": "multi_select_checkbox",
                        "config": {"required": False, "options": [{"option_id": "opt_blue", "value": "blue", "label": "Blue"}]},
                    },
                ]
            },
        )
        assert res.status_code == 200
        # PUT returns the raw config (the editor's view) — archived options
        # stay present with is_archived: true, not silently dropped.
        returned_ids = {o["option_id"]: o["is_archived"] for o in res.json()[0]["config"]["options"]}
        assert returned_ids == {"opt_blue": False, "opt_red": True}

        db.refresh(field)
        stored_ids = {o["option_id"]: o["is_archived"] for o in field.config["options"]}
        assert stored_ids == {"opt_blue": False, "opt_red": True}

        # But GET (the respondent-facing render) filters archived options out.
        res = client.get(f"/forms/{form.id}/")
        rendered_ids = {o["option_id"] for o in res.json()["fields"][0]["config"]["options"]}
        assert rendered_ids == {"opt_blue"}

        # The prior answer referencing opt_red is untouched in storage — it
        # keeps the value/label snapshot from when it was submitted, even
        # though the option itself is now archived.
        answer = db.query(FormAnswer).filter(FormAnswer.field_id == field.id).one()
        assert answer.value == [{"option_id": "opt_red", "value": "red", "label": "Red"}]

        pending = (
            db.query(FormResponsePendingUpdate)
            .filter(FormResponsePendingUpdate.response_id == response_id, FormResponsePendingUpdate.field_key == "color")
            .first()
        )
        assert pending is not None
        assert pending.reason == "option_archived"

    def test_pending_update_cleared_on_fresh_submission(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(
            db, form, field_key="color", question_type="multi_select_checkbox",
            config={
                "required": False,
                "options": [
                    {"option_id": "opt_red", "value": "red", "label": "Red"},
                    {"option_id": "opt_blue", "value": "blue", "label": "Blue"},
                ],
            },
        )
        db.commit()
        login(client, "td@test.com", "tdpass")
        self._publish(client, form)

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_red"]}]})
        response_id = res.json()["id"]

        client.put(
            f"/forms/{form.id}/fields/",
            json={
                "fields": [
                    {
                        "id": field.id, "label": "Favorite color", "question_type": "multi_select_checkbox",
                        "config": {"required": False, "options": [{"option_id": "opt_blue", "value": "blue", "label": "Blue"}]},
                    },
                ]
            },
        )
        assert db.query(FormResponsePendingUpdate).filter(FormResponsePendingUpdate.response_id == response_id).count() == 1

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_blue"]}]})
        assert res.status_code == 200
        assert db.query(FormResponsePendingUpdate).filter(FormResponsePendingUpdate.response_id == response_id).count() == 0

    def test_field_replaced_flags_pending_update_for_prior_answer(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(db, form, field_key="color", question_type="short_text", config={"required": False, "max_length": 50})
        db.commit()
        login(client, "td@test.com", "tdpass")
        self._publish(client, form)

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": "blue"}]})
        response_id = res.json()["id"]

        client.put(
            f"/forms/{form.id}/fields/",
            json={"fields": [{"id": field.id, "label": "Color", "question_type": "long_text", "config": {"required": False, "max_length": 500}}]},
        )

        pending = (
            db.query(FormResponsePendingUpdate)
            .filter(FormResponsePendingUpdate.response_id == response_id, FormResponsePendingUpdate.field_key == "color")
            .first()
        )
        assert pending is not None
        assert pending.reason == "field_replaced"

    def test_option_without_option_id_gets_one_generated(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.put(
            f"/forms/{form.id}/fields/",
            json={
                "fields": [
                    {
                        "label": "Color", "field_key": "color", "question_type": "multi_select_checkbox",
                        "config": {
                            "required": False,
                            "options": [{"value": "red", "label": "Red"}, {"value": "blue", "label": "Blue"}],
                        },
                    },
                ]
            },
        )
        assert res.status_code == 200
        options = res.json()[0]["config"]["options"]
        ids = [o["option_id"] for o in options]
        assert all(ids)
        assert len(set(ids)) == 2

    def test_option_id_preserved_across_update_when_echoed_back(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(
            db, form, field_key="color", question_type="multi_select_checkbox",
            config={"required": False, "options": [{"option_id": "opt_red", "value": "red", "label": "Red"}]},
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.put(
            f"/forms/{form.id}/fields/",
            json={
                "fields": [
                    {
                        "id": field.id, "label": "Favorite color", "question_type": "multi_select_checkbox",
                        "config": {
                            "required": False,
                            "options": [
                                {"option_id": "opt_red", "value": "red", "label": "Red"},
                                {"value": "blue", "label": "Blue"},
                            ],
                        },
                    },
                ]
            },
        )
        assert res.status_code == 200
        options = res.json()[0]["config"]["options"]
        by_value = {o["value"]: o["option_id"] for o in options}
        assert by_value["red"] == "opt_red"
        assert by_value["blue"] != "opt_red"
        assert by_value["blue"]

    def test_duplicate_option_id_within_field_rejected(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.put(
            f"/forms/{form.id}/fields/",
            json={
                "fields": [
                    {
                        "label": "Color", "field_key": "color", "question_type": "multi_select_checkbox",
                        "config": {
                            "required": False,
                            "options": [
                                {"option_id": "opt_1", "value": "red", "label": "Red"},
                                {"option_id": "opt_1", "value": "blue", "label": "Blue"},
                            ],
                        },
                    },
                ]
            },
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# POST /forms/{form_id}/responses/ — submission and resubmission
# ---------------------------------------------------------------------------

class TestSubmitResponse:
    def test_first_submission_creates_response(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="published")
        field = _make_field(db, form, field_key="color")
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": field.id, "value": ["opt_1"]}]},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["form_id"] == form.id
        assert len(data["answers"]) == 1
        assert data["answers"][0]["value"] == ["opt_1"]

    def test_resubmission_overwrites_in_place(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="published")
        field = _make_field(db, form, field_key="color")
        db.commit()
        login(client, "td@test.com", "tdpass")

        client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_1"]}]})
        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_2"]}]})

        assert res.status_code == 200
        assert len(res.json()["answers"]) == 1
        assert res.json()["answers"][0]["value"] == ["opt_2"]
        assert db.query(FormResponse).filter(FormResponse.form_id == form.id, FormResponse.user_id == td_user.id).count() == 1

    def test_invalid_field_id_rejected(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="published")
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": "nonexistent12", "value": "x"}]})
        assert res.status_code == 400

    def test_non_member_forbidden(self, client, db, td_user, td_tournament, other_user):
        form = _make_form(db, td_user, td_tournament, status="published")
        db.commit()
        login(client, "other@test.com", "otherpass")
        res = client.post(f"/forms/{form.id}/responses/", json={"answers": []})
        assert res.status_code == 403

    def test_draft_form_rejects_submission(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)  # draft by default
        field = _make_field(db, form, field_key="color")
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_1"]}]})
        assert res.status_code == 409

    def test_archived_form_rejects_submission(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="archived")
        field = _make_field(db, form, field_key="color")
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_1"]}]})
        assert res.status_code == 409


class TestAnswerSnapshotting:
    """A select-type answer stores a {option_id, value, label} snapshot at
    submission time, not a bare option_id — so a later edit to the option's
    value/label doesn't retroactively change how a past answer displays."""

    def test_multi_select_answer_stores_value_label_snapshot(self, client, db, td_user, td_tournament):
        form = _make_form(
            db, td_user, td_tournament, status="published",
        )
        field = _make_field(
            db, form, field_key="topics", question_type="multi_select_checkbox",
            config={
                "required": False,
                "options": [
                    {"option_id": "opt_red", "value": "red", "label": "Red"},
                    {"option_id": "opt_blue", "value": "blue", "label": "Blue"},
                ],
            },
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_red"]}]})
        assert res.status_code == 200
        assert res.json()["answers"][0]["value"] == [{"option_id": "opt_red", "value": "red", "label": "Red"}]

    def test_snapshot_survives_later_value_rename(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        field = _make_field(
            db, form, field_key="topics", question_type="multi_select_checkbox",
            config={"required": False, "options": [{"option_id": "opt_red", "value": "red", "label": "Red"}]},
        )
        db.commit()
        login(client, "td@test.com", "tdpass")
        client.patch(f"/forms/{form.id}/", json={"status": "published"})

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_red"]}]})
        response_id = res.json()["id"]

        client.put(
            f"/forms/{form.id}/fields/",
            json={
                "fields": [
                    {
                        "id": field.id, "label": "Topics", "question_type": "multi_select_checkbox",
                        "config": {
                            "required": False,
                            "options": [{"option_id": "opt_red", "value": "crimson", "label": "Crimson"}],
                        },
                    },
                ]
            },
        )

        answer = db.query(FormAnswer).filter(FormAnswer.response_id == response_id).one()
        # Old answer still reads "Red" even though the option is now "Crimson".
        assert answer.value == [{"option_id": "opt_red", "value": "red", "label": "Red"}]


# ---------------------------------------------------------------------------
# Write-through — availability/lunch reserved-key answers syncing into their
# structural tables (app/core/form/write_through.py), tournament-owned forms
# only. See tests/core/test_form_write_through.py for the diff-sync logic
# itself; this covers the route wiring.
# ---------------------------------------------------------------------------

class TestWriteThroughOnSubmit:
    def test_availability_write_through_on_tournament_form(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="published")
        shift = TournamentShift(
            tournament_id=td_tournament.id,
            label="Saturday",
            start=datetime.now(timezone.utc),
            end=datetime.now(timezone.utc) + timedelta(hours=8),
        )
        db.add(shift)
        db.flush()
        field = _make_field(
            db, form, field_key="availability_20260315", question_type="multi_select_checkbox",
            config={"required": False, "options": [{"option_id": f"opt_{shift.id}", "value": [shift.id], "label": shift.label}]},
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": field.id, "value": [f"opt_{shift.id}"]}]},
        )
        assert res.status_code == 200

        membership = (
            db.query(TournamentMembership)
            .filter(TournamentMembership.user_id == td_user.id, TournamentMembership.tournament_id == td_tournament.id)
            .first()
        )
        rows = db.query(TournamentMembershipAvailability).filter(
            TournamentMembershipAvailability.membership_id == membership.id
        ).all()
        assert [row.tournament_shift_id for row in rows] == [shift.id]

    def _shift_ids(self, db, membership_id):
        return {
            row.tournament_shift_id
            for row in db.query(TournamentMembershipAvailability).filter(
                TournamentMembershipAvailability.membership_id == membership_id
            ).all()
        }

    def _membership_id(self, db, user, tournament):
        return (
            db.query(TournamentMembership)
            .filter(TournamentMembership.user_id == user.id, TournamentMembership.tournament_id == tournament.id)
            .first()
            .id
        )

    def test_grouped_availability_option_writes_one_row_per_shift(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="published")
        morning = TournamentShift(tournament_id=td_tournament.id, label="Morning", start=datetime.now(timezone.utc), end=datetime.now(timezone.utc) + timedelta(hours=4))
        afternoon = TournamentShift(tournament_id=td_tournament.id, label="Afternoon", start=datetime.now(timezone.utc) + timedelta(hours=4), end=datetime.now(timezone.utc) + timedelta(hours=8))
        db.add_all([morning, afternoon])
        db.flush()
        field = _make_field(
            db, form, field_key="availability_20260315", question_type="single_select_radio",
            config={"required": False, "options": [{"option_id": "opt_all_day", "value": [morning.id, afternoon.id], "label": "All Day"}]},
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": "opt_all_day"}]})
        assert res.status_code == 200

        membership_id = self._membership_id(db, td_user, td_tournament)
        assert self._shift_ids(db, membership_id) == {morning.id, afternoon.id}

    def test_overlapping_selected_options_dedupe_shared_shift(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="published")
        morning = TournamentShift(tournament_id=td_tournament.id, label="Morning", start=datetime.now(timezone.utc), end=datetime.now(timezone.utc) + timedelta(hours=4))
        afternoon = TournamentShift(tournament_id=td_tournament.id, label="Afternoon", start=datetime.now(timezone.utc) + timedelta(hours=4), end=datetime.now(timezone.utc) + timedelta(hours=8))
        db.add_all([morning, afternoon])
        db.flush()
        field = _make_field(
            db, form, field_key="availability_20260315", question_type="multi_select_checkbox",
            config={
                "required": False,
                "options": [
                    {"option_id": "opt_morning", "value": [morning.id], "label": "Morning"},
                    {"option_id": "opt_all_day", "value": [morning.id, afternoon.id], "label": "All Day"},
                ],
            },
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": field.id, "value": ["opt_morning", "opt_all_day"]}]},
        )
        assert res.status_code == 200

        membership_id = self._membership_id(db, td_user, td_tournament)
        assert self._shift_ids(db, membership_id) == {morning.id, afternoon.id}

    def test_deselecting_option_keeps_shift_still_covered_by_another(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="published")
        morning = TournamentShift(tournament_id=td_tournament.id, label="Morning", start=datetime.now(timezone.utc), end=datetime.now(timezone.utc) + timedelta(hours=4))
        afternoon = TournamentShift(tournament_id=td_tournament.id, label="Afternoon", start=datetime.now(timezone.utc) + timedelta(hours=4), end=datetime.now(timezone.utc) + timedelta(hours=8))
        db.add_all([morning, afternoon])
        db.flush()
        field = _make_field(
            db, form, field_key="availability_20260315", question_type="multi_select_checkbox",
            config={
                "required": False,
                "options": [
                    {"option_id": "opt_morning", "value": [morning.id], "label": "Morning"},
                    {"option_id": "opt_all_day", "value": [morning.id, afternoon.id], "label": "All Day"},
                ],
            },
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_morning", "opt_all_day"]}]})
        # Deselect "All Day" — "Morning" alone still covers the morning shift.
        res = client.post(f"/forms/{form.id}/responses/", json={"answers": [{"field_id": field.id, "value": ["opt_morning"]}]})
        assert res.status_code == 200

        membership_id = self._membership_id(db, td_user, td_tournament)
        assert self._shift_ids(db, membership_id) == {morning.id}

    def test_two_availability_fields_disjoint_selections_both_persist(self, client, db, td_user, td_tournament):
        saturday = TournamentShift(tournament_id=td_tournament.id, label="Saturday", start=datetime.now(timezone.utc), end=datetime.now(timezone.utc) + timedelta(hours=4))
        sunday = TournamentShift(tournament_id=td_tournament.id, label="Sunday", start=datetime.now(timezone.utc) + timedelta(days=1), end=datetime.now(timezone.utc) + timedelta(days=1, hours=4))
        db.add_all([saturday, sunday])
        db.flush()
        form = _make_form(db, td_user, td_tournament, status="published")
        field_sat = _make_field(
            db, form, field_key="availability_20260314", question_type="multi_select_checkbox",
            config={"required": False, "options": [{"option_id": "opt_sat", "value": [saturday.id], "label": "Saturday"}]},
        )
        field_sun = _make_field(
            db, form, field_key="availability_20260315", question_type="multi_select_checkbox",
            config={"required": False, "options": [{"option_id": "opt_sun", "value": [sunday.id], "label": "Sunday"}]},
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [
                {"field_id": field_sat.id, "value": ["opt_sat"]},
                {"field_id": field_sun.id, "value": ["opt_sun"]},
            ]},
        )
        assert res.status_code == 200

        membership_id = self._membership_id(db, td_user, td_tournament)
        assert self._shift_ids(db, membership_id) == {saturday.id, sunday.id}

    def test_two_availability_fields_overlapping_selections_dedupe(self, client, db, td_user, td_tournament):
        shared = TournamentShift(tournament_id=td_tournament.id, label="Shared", start=datetime.now(timezone.utc), end=datetime.now(timezone.utc) + timedelta(hours=4))
        db.add(shared)
        db.flush()
        form = _make_form(db, td_user, td_tournament, status="published")
        field_a = _make_field(
            db, form, field_key="availability_20260314", question_type="multi_select_checkbox",
            config={"required": False, "options": [{"option_id": "opt_a", "value": [shared.id], "label": "Shared"}]},
        )
        field_b = _make_field(
            db, form, field_key="availability_20260315", question_type="multi_select_checkbox",
            config={"required": False, "options": [{"option_id": "opt_b", "value": [shared.id], "label": "Shared"}]},
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [
                {"field_id": field_a.id, "value": ["opt_a"]},
                {"field_id": field_b.id, "value": ["opt_b"]},
            ]},
        )
        assert res.status_code == 200

        membership_id = self._membership_id(db, td_user, td_tournament)
        rows = db.query(TournamentMembershipAvailability).filter(
            TournamentMembershipAvailability.membership_id == membership_id
        ).all()
        assert [row.tournament_shift_id for row in rows] == [shared.id]

    def test_blanking_one_of_two_availability_fields_only_clears_its_own_shifts(self, client, db, td_user, td_tournament):
        saturday = TournamentShift(tournament_id=td_tournament.id, label="Saturday", start=datetime.now(timezone.utc), end=datetime.now(timezone.utc) + timedelta(hours=4))
        sunday = TournamentShift(tournament_id=td_tournament.id, label="Sunday", start=datetime.now(timezone.utc) + timedelta(days=1), end=datetime.now(timezone.utc) + timedelta(days=1, hours=4))
        db.add_all([saturday, sunday])
        db.flush()
        form = _make_form(db, td_user, td_tournament, status="published")
        field_sat = _make_field(
            db, form, field_key="availability_20260314", question_type="multi_select_checkbox",
            config={"required": False, "options": [{"option_id": "opt_sat", "value": [saturday.id], "label": "Saturday"}]},
        )
        field_sun = _make_field(
            db, form, field_key="availability_20260315", question_type="multi_select_checkbox",
            config={"required": False, "options": [{"option_id": "opt_sun", "value": [sunday.id], "label": "Sunday"}]},
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [
                {"field_id": field_sat.id, "value": ["opt_sat"]},
                {"field_id": field_sun.id, "value": ["opt_sun"]},
            ]},
        )
        # Resubmit with the Saturday field blanked — Sunday's shift should
        # survive untouched.
        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [
                {"field_id": field_sun.id, "value": ["opt_sun"]},
            ]},
        )
        assert res.status_code == 200

        membership_id = self._membership_id(db, td_user, td_tournament)
        assert self._shift_ids(db, membership_id) == {sunday.id}

    def test_lunch_write_through_on_tournament_form(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="published")
        field = _make_field(
            db, form, field_key="lunch_20270213_protein", question_type="single_select_radio",
            config={
                "required": False,
                "options": [
                    {"option_id": "opt_chicken", "value": "chicken", "label": "Chicken"},
                    {"option_id": "opt_tofu", "value": "tofu", "label": "Tofu"},
                ],
            },
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": field.id, "value": "opt_chicken"}]},
        )
        assert res.status_code == 200

        membership = (
            db.query(TournamentMembership)
            .filter(TournamentMembership.user_id == td_user.id, TournamentMembership.tournament_id == td_tournament.id)
            .first()
        )
        rows = db.query(TournamentMembershipLunch).filter(
            TournamentMembershipLunch.membership_id == membership.id
        ).all()
        assert len(rows) == 1
        assert rows[0].value == "chicken"
        assert rows[0].label == "Chicken"
        assert rows[0].category == "protein"
        assert rows[0].date == date(2027, 2, 13)

    def test_availability_answer_on_chapter_form_saves_but_does_not_write_through(self, client, db, td_user, chapter):
        form = _make_chapter_form(db, td_user, chapter, status="published")
        field = _make_field(
            db, form, field_key="availability_20260315", question_type="multi_select_checkbox",
            config={"required": False, "options": [{"option_id": "opt_1", "value": "not_a_real_shift_id", "label": "Whenever"}]},
        )
        db.commit()
        _chapter_lead(db, chapter)
        login(client, "chapterlead@test.com", "LeadPass123!")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": field.id, "value": ["not_a_real_shift_id"]}]},
        )
        assert res.status_code == 200
        assert res.json()["answers"][0]["value"] == ["not_a_real_shift_id"]
        assert db.query(TournamentMembershipAvailability).count() == 0

    def test_lunch_answer_on_chapter_form_saves_but_does_not_write_through(self, client, db, td_user, chapter):
        form = _make_chapter_form(db, td_user, chapter, status="published")
        field = _make_field(
            db, form, field_key="lunch_20270213_protein", question_type="single_select_radio",
            config={"required": False, "options": [{"option_id": "opt_chicken", "value": "chicken", "label": "Chicken"}]},
        )
        db.commit()
        _chapter_lead(db, chapter)
        login(client, "chapterlead@test.com", "LeadPass123!")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": field.id, "value": "opt_chicken"}]},
        )
        assert res.status_code == 200
        assert db.query(TournamentMembershipLunch).count() == 0


# ---------------------------------------------------------------------------
# GET /forms/{form_id}/responses/ and /responses/me/
# ---------------------------------------------------------------------------

class TestListAndMyResponses:
    def test_manager_can_list_responses(self, client, db, td_user, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Runner")
        form = _make_form(db, td_user, td_tournament)
        db.add(FormResponse(form_id=form.id, user_id=other_user.id))
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/forms/{form.id}/responses/")
        assert res.status_code == 200
        assert len(res.json()) == 1

    def test_plain_member_cannot_list_responses(self, client, db, td_user, td_tournament, other_user):
        grant_role(db, td_tournament, other_user, "Runner")
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "other@test.com", "otherpass")
        res = client.get(f"/forms/{form.id}/responses/")
        assert res.status_code == 403

    def test_me_returns_own_response(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.add(FormResponse(form_id=form.id, user_id=td_user.id))
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/forms/{form.id}/responses/me/")
        assert res.status_code == 200
        assert res.json()["user_id"] == td_user.id

    def test_me_404_when_no_response(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament)
        db.commit()
        login(client, "td@test.com", "tdpass")
        res = client.get(f"/forms/{form.id}/responses/me/")
        assert res.status_code == 404


# ---------------------------------------------------------------------------
# Submission-time required enforcement via branching reachability replay
# ---------------------------------------------------------------------------

class TestSubmissionReachabilityEnforcement:
    def test_submission_rejected_when_reachable_required_field_missing(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="published")
        required_field = _make_field(
            db, form, order=1, field_key="required_field", question_type="short_text",
            config={"required": True, "max_length": 100},
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(f"/forms/{form.id}/responses/", json={"answers": []})
        assert res.status_code == 400

    def test_submission_accepted_when_branch_skips_required_field(self, client, db, td_user, td_tournament):
        form = _make_form(db, td_user, td_tournament, status="published")
        skipped = _make_field(
            db, form, order=2, field_key="skipped", question_type="short_text",
            config={"required": True, "max_length": 100},
        )
        target = _make_field(db, form, order=3, field_key="target", question_type="short_text",
                              config={"required": False, "max_length": 100})
        branch_field = _make_field(
            db, form, order=1, field_key="branch", question_type="single_select_radio",
            config={
                "required": True,
                "options": [
                    {"option_id": "opt_yes", "value": "yes", "label": "Yes", "next_field_id": target.id},
                    {"option_id": "opt_no", "value": "no", "label": "No"},
                ],
            },
        )
        db.commit()
        login(client, "td@test.com", "tdpass")

        res = client.post(
            f"/forms/{form.id}/responses/",
            json={"answers": [{"field_id": branch_field.id, "value": "opt_yes"}]},
        )
        assert res.status_code == 200
