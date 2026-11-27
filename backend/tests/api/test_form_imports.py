"""Route tests for app/api/routes/form_imports.py. Google is faked through get_google_client."""

import io

import pytest
from openpyxl import Workbook

from app.api.routes.form_imports import get_google_client
from app.core.form.import_sources import Cell, SourceTable
from app.core.tournament.permissions import MANAGE_FORMS
from app.main import app
from app.models.models import Form, FormField, TournamentForm, TournamentRole
from app.services.google_import import GoogleForm, GoogleQuestion, SheetTab
from tests.conftest import grant_role, login

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
