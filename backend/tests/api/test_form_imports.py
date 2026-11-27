"""Route tests for app/api/routes/form_imports.py. Google is faked through get_google_client."""

import io
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from openpyxl import Workbook

from app.api.routes.form_imports import get_google_client
from app.core.form.import_sources import Cell, SourceTable
from app.core.tournament.permissions import MANAGE_FORMS
from app.main import app
from app.models.models import (
    AuditLogEntry,
    Form,
    FormField,
    FormResponse,
    TournamentForm,
    TournamentMembership,
    TournamentMembershipTrackStatus,
    TournamentRole,
    User,
)
from app.services.google_import import GoogleForm, GoogleQuestion, SheetTab
from tests.conftest import grant_role, login, primary_track_id

CSV = (
    b"Timestamp,Email Address,Name,Shirt,Avail [Sat],Avail [Sun]\n"
    b"11/13/2026 14:02:33,ann@example.com,Ann Lee,M,AM,PM\n"
    b"11/14/2026 09:00:00,bo@example.com,Bo Park,m,PM,\n"
)


class FakeGoogle:
    def __init__(self):
        self.read_tabs: list[str] = []

    def sheet_tabs(self, spreadsheet_id):
        return [SheetTab(gid=0, title="Notes"), SheetTab(gid=77, title="Form Responses 1")]

    def sheet_table(self, spreadsheet_id, tab):
        self.read_tabs.append(tab)
        return SourceTable(
            headers=["Email Address", "Shirt"],
            rows=[[Cell("ann@example.com"), Cell("S")]],
        )

    def form(self, form_id):
        return GoogleForm(
            title="Interest",
            questions=[GoogleQuestion(title="Shirt", kind="radio", options=["S", "M", "L"])],
        )


@pytest.fixture
def google():
    fake = FakeGoogle()
    app.dependency_overrides[get_google_client] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_google_client, None)


def _create(client, tournament, **data):
    files = data.pop("files", {"file": ("people.csv", CSV, "text/csv")})
    return client.post(
        f"/tournaments/{tournament.id}/forms/imports/",
        data={"name": "Interest import", **data},
        files=files,
    )


def test_upload_creates_a_draft_import_form(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    res = _create(client, td_tournament)
    assert res.status_code == 201
    form = db.get(Form, res.json()["id"])
    assert (form.kind, form.status) == ("import", "draft")
    assert form.import_source["kind"] == "upload"
    assert form.import_source["identity"] == {
        "email": "Email Address",
        "full_name": "Name",
        "timestamp": "Timestamp",
    }
    assert db.query(TournamentForm).filter_by(form_id=form.id).one()
    fields = db.query(FormField).filter_by(form_id=form.id).order_by(FormField.order).all()
    assert [(f.field_key, f.question_type) for f in fields] == [
        ("shirt", "single_select_dropdown"),
        ("avail", "grid_single"),
    ]
    assert fields[1].import_mapping["shape"] == "grid"


def test_needs_both_forms_and_members_permissions(client, db, td_tournament, other_user):
    grant_role(db, td_tournament, other_user, "Runner")
    db.query(TournamentRole).filter_by(
        tournament_id=td_tournament.id, label="Runner"
    ).one().permissions = [MANAGE_FORMS]
    db.commit()
    login(client, "other@test.com", "otherpass")
    assert _create(client, td_tournament).status_code == 403
    assert (
        client.get(f"/tournaments/{td_tournament.id}/imports/service-account/").status_code == 403
    )


def test_email_column(client, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    no_email = {"file": ("people.csv", b"Contact,Shirt\nann@example.com,M\n", "text/csv")}
    res = _create(client, td_tournament, files=no_email)
    assert res.status_code == 422
    assert "email" in res.json()["detail"]
    assert _create(client, td_tournament, files=no_email, email_column="Contact").status_code == 201
    assert _create(client, td_tournament, files=no_email, email_column="Nope").status_code == 422


def test_google_sheet_with_form(client, db, td_user, td_tournament, google):
    login(client, "td@test.com", "tdpass")
    sheet = "https://docs.google.com/spreadsheets/d/abc123/edit#gid=77"
    res = _create(
        client,
        td_tournament,
        files={},
        sheet_url=sheet,
        form_url="https://docs.google.com/forms/d/form9/edit",
    )
    assert res.status_code == 201
    assert google.read_tabs == ["Form Responses 1"]
    form = db.get(Form, res.json()["id"])
    assert form.import_source["spreadsheet_id"] == "abc123"
    assert form.import_source["google_form_id"] == "form9"
    shirt = db.query(FormField).filter_by(form_id=form.id).one()
    # The form supplies every option, not just the ones answered.
    assert [o["label"] for o in shirt.config["options"]] == ["S", "M", "L"]

    respondent_link = _create(
        client,
        td_tournament,
        files={},
        sheet_url=sheet,
        form_url="https://docs.google.com/forms/d/e/1FAIp/viewform",
    )
    assert respondent_link.status_code == 422
    both = _create(client, td_tournament, sheet_url=sheet)
    assert both.status_code == 422


def test_tabs(client, td_user, td_tournament, google):
    login(client, "td@test.com", "tdpass")
    url = f"/tournaments/{td_tournament.id}/imports/tabs/"
    sheet = client.post(
        url, data={"sheet_url": "https://docs.google.com/spreadsheets/d/x/edit#gid=77"}
    )
    assert sheet.json() == {"tabs": ["Notes", "Form Responses 1"], "selected": "Form Responses 1"}

    workbook = Workbook()
    workbook.active.title = "Responses"
    workbook.create_sheet("Other")
    buffer = io.BytesIO()
    workbook.save(buffer)
    xlsx = client.post(
        url, files={"file": ("people.xlsx", buffer.getvalue(), "application/octet-stream")}
    )
    assert xlsx.json() == {"tabs": ["Responses", "Other"], "selected": "Responses"}


def _created(client, db, tournament):
    form = db.get(Form, _create(client, tournament).json()["id"])
    fields = db.query(FormField).filter_by(form_id=form.id).order_by(FormField.order).all()
    return form, fields


def _entry(field, **overrides):
    entry = {
        "id": field.id,
        "label": field.label,
        "question_type": field.question_type,
        "config": field.config,
        "import_mapping": field.import_mapping,
    }
    entry.update(overrides)
    return entry


def test_import_settings_read_and_update(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    form, fields = _created(client, db, td_tournament)

    settings = client.get(f"/forms/{form.id}/import/").json()
    assert settings["source"]["identity"]["email"] == "Email Address"
    shirt_mapping = settings["mappings"][fields[0].id]
    assert (shirt_mapping["shape"], shirt_mapping["columns"][0]["header"]) == ("column", "Shirt")

    identity = {"email": "Email Address", "first_name": "Name"}
    res = client.patch(f"/forms/{form.id}/import/", json={"identity": identity})
    saved = res.json()["source"]["identity"]
    assert {k: v for k, v in saved.items() if v} == identity
    assert client.patch(f"/forms/{form.id}/import/", json={"sheet_tab": "x"}).status_code == 422

    standard = Form(
        owner_type="tournament", tournament_id=td_tournament.id, name="Plain", created_by=td_user.id
    )
    db.add(standard)
    db.commit()
    assert client.get(f"/forms/{standard.id}/import/").status_code == 404


def test_saving_fields_checks_and_keeps_mappings(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    form, (shirt, grid) = _created(client, db, td_tournament)
    url = f"/forms/{form.id}/fields/"

    assert client.put(url, json={"fields": [_entry(shirt), _entry(grid)]}).status_code == 200
    db.expire_all()
    assert db.get(FormField, grid.id).import_mapping["shape"] == "grid"

    unknown_row = {
        **grid.import_mapping,
        "columns": [{"header": "Avail [Sat]", "option_id": "nope"}],
    }
    text_with_grid_mapping = _entry(
        shirt,
        question_type="short_text",
        config={"required": False, "max_length": 50},
        import_mapping=grid.import_mapping,
    )
    for bad in (
        [_entry(shirt), _entry(grid, import_mapping=unknown_row)],
        [text_with_grid_mapping, _entry(grid)],
    ):
        assert client.put(url, json={"fields": bad}).status_code == 422

    # The payload is the target state: a question sent without a mapping loses it.
    client.put(url, json={"fields": [_entry(shirt, import_mapping=None), _entry(grid)]})
    db.expire_all()
    assert db.get(FormField, shirt.id).import_mapping is None


def test_standard_forms_take_no_mapping(client, db, td_user, td_tournament):
    form = Form(
        owner_type="tournament", tournament_id=td_tournament.id, name="Plain", created_by=td_user.id
    )
    db.add(form)
    db.commit()
    login(client, "td@test.com", "tdpass")
    entry = {
        "label": "Shirt",
        "question_type": "short_text",
        "config": {"required": False, "max_length": 50},
        "import_mapping": {"shape": "column", "columns": [{"header": "Shirt"}]},
    }
    assert client.put(f"/forms/{form.id}/fields/", json={"fields": [entry]}).status_code == 422


# ---------------------------------------------------------------------------
# POST /forms/{form_id}/import/
# ---------------------------------------------------------------------------

HEADER = "Timestamp,Email Address,Name,Shirt,Avail [Sat],Avail [Sun]\n"


def _run(client, form, rows, dry_run=False, filename="people.csv"):
    return client.post(
        f"/forms/{form.id}/import/",
        data={"dry_run": str(dry_run).lower()},
        files={"file": (filename, (HEADER + "".join(rows)).encode(), "text/csv")},
    )


def _response(db, form, user):
    return db.query(FormResponse).filter_by(form_id=form.id, user_id=user.id).one_or_none()


def test_dry_run_reports_and_import_writes(client, db, td_user, td_tournament, other_user):
    login(client, "td@test.com", "tdpass")
    form, (shirt, grid) = _created(client, db, td_tournament)
    rows = [
        "11/13/2026 14:02:33,ann@example.com,Ann Lee,M,AM,PM\n",
        "11/14/2026 09:00:00,other@test.com,Zed Q,Purple,PM,\n",
    ]

    preview = _run(client, form, rows, dry_run=True).json()
    assert (preview["imported"], preview["invited_users"], preview["existing_users"]) == (2, 1, 1)
    assert preview["new_memberships"] == 2
    assert [(p["row"], p["skipped"]) for p in preview["problems"]] == [(3, False)]
    db.expire_all()
    assert db.query(User).filter_by(email="ann@example.com").first() is None

    assert _run(client, form, rows).json() == {**preview, "dry_run": False}
    db.expire_all()
    ann = db.query(User).filter_by(email="ann@example.com").one()
    assert (ann.status, ann.hashed_password, ann.first_name, ann.last_name) == (
        "invited",
        None,
        "Ann",
        "Lee",
    )
    assert db.query(TournamentMembership).filter_by(user_id=ann.id).one().source == "import"
    response = _response(db, form, ann)
    tz = ZoneInfo(td_tournament.timezone)
    assert response.submitted_at == datetime(2026, 11, 13, 14, 2, 33, tzinfo=tz)
    answers = {a.field_id: a.value for a in response.answers}
    assert answers[shirt.id]["label"] == "M"
    # The bad Shirt cell drops only that answer; the grid still imports.
    other_answers = {a.field_id for a in _response(db, form, other_user).answers}
    assert other_answers == {grid.id}
    # An existing account is attached, never rewritten.
    assert other_user.first_name != "Zed"
    entry = db.query(AuditLogEntry).filter_by(action="form_imported").one()
    assert entry.extra_data["invited_user_ids"] == [ann.id]


def test_skipped_rows_and_duplicate_emails(client, db, td_user, td_tournament):
    db.add(User(email="gone@example.com", status="deactivated"))
    db.commit()
    login(client, "td@test.com", "tdpass")
    form, (shirt, _) = _created(client, db, td_tournament)
    report = _run(
        client,
        form,
        [
            "11/13/2026 10:00:00,ann@example.com,Ann Lee,M,,\n",
            "11/12/2026 10:00:00,ann@example.com,Ann Lee,m,,\n",
            ",not-an-email,Nobody,M,,\n",
            ",gone@example.com,Gone,M,,\n",
        ],
    ).json()
    assert report["imported"] == 1
    skipped = sorted(p["row"] for p in report["problems"] if p["skipped"])
    assert skipped == [3, 4, 5]
    db.expire_all()
    ann = db.query(User).filter_by(email="ann@example.com").one()
    # The newer row wins though it comes first.
    assert _response(db, form, ann).submitted_at.day == 13
    assert db.query(User).filter_by(email="gone@example.com").one().status == "deactivated"


def test_reimport_overwrites_people_in_the_file_and_keeps_the_rest(
    client, db, td_user, td_tournament
):
    login(client, "td@test.com", "tdpass")
    form, (shirt, _) = _created(client, db, td_tournament)
    _run(
        client,
        form,
        [",ann@example.com,Ann Lee,M,,\n", ",bo@example.com,Bo Park,M,,\n"],
    )
    report = _run(client, form, [",ann@example.com,Ann Lee,,AM,\n"]).json()
    assert (report["overwritten_responses"], report["new_memberships"]) == (1, 0)
    db.expire_all()
    ann = db.query(User).filter_by(email="ann@example.com").one()
    bo = db.query(User).filter_by(email="bo@example.com").one()
    assert shirt.id not in {a.field_id for a in _response(db, form, ann).answers}
    assert {a.field_id for a in _response(db, form, bo).answers} == {shirt.id}


def test_import_writes_through_track_status(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    form, (shirt, grid) = _created(client, db, td_tournament)
    track_id = primary_track_id(db, td_tournament.id)
    attending = {
        "field_key": "track_status_attending",
        "label": "Attending?",
        "question_type": "single_select_radio",
        "config": {
            "required": False,
            "options": [
                {
                    "option_id": "yes",
                    "label": "Yes",
                    "value": [{"id": track_id, "status": "confirmed"}],
                }
            ],
        },
        "import_mapping": {"shape": "column", "columns": [{"header": "Avail [Sun]"}]},
    }
    res = client.put(
        f"/forms/{form.id}/fields/", json={"fields": [_entry(shirt), _entry(grid), attending]}
    )
    assert res.status_code == 200
    _run(client, form, [",ann@example.com,Ann Lee,M,AM,Yes\n"])
    db.expire_all()
    ann = db.query(User).filter_by(email="ann@example.com").one()
    membership = db.query(TournamentMembership).filter_by(user_id=ann.id).one()
    status = db.query(TournamentMembershipTrackStatus).filter_by(membership_id=membership.id).one()
    assert (status.track_id, status.status) == (track_id, "confirmed")


def test_import_source_rejections(client, db, td_user, td_tournament):
    login(client, "td@test.com", "tdpass")
    form, _ = _created(client, db, td_tournament)
    assert client.post(f"/forms/{form.id}/import/", data={"dry_run": "true"}).status_code == 422
    assert _run(client, form, [], filename="people.xlsx").status_code == 422
    no_email = client.post(
        f"/forms/{form.id}/import/",
        files={"file": ("people.csv", b"Name,Shirt\nAnn,M\n", "text/csv")},
    )
    assert no_email.status_code == 422
    assert "Email Address" in no_email.json()["detail"]
