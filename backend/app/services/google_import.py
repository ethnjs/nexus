"""Reads a Google Sheet tab and a Google Form's questions for an import.

A TD shares both with the NEXUS service account, which reads them with one credential.
"""

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from functools import cached_property
from typing import Any, Literal
from zoneinfo import ZoneInfo

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.core.config import get_settings
from app.core.form.import_sources import Cell, ImportSourceError, SourceTable, build_table

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/forms.body.readonly",
]

_SPREADSHEET_ID = re.compile(r"/spreadsheets/d/([A-Za-z0-9_-]+)")
_GID = re.compile(r"[#&?]gid=(\d+)")
_FORM_ID = re.compile(r"/forms/d/([A-Za-z0-9_-]+)")
_RESPONDER_FORM = re.compile(r"/forms/d/e/")

# Sheets counts days from 1899-12-30.
_SERIAL_EPOCH = datetime(1899, 12, 30)


def parse_spreadsheet_url(url: str) -> tuple[str, int | None]:
    """The spreadsheet id and, when the link points at a tab, that tab's gid."""
    match = _SPREADSHEET_ID.search(url)
    if not match:
        raise ImportSourceError("That isn't a Google Sheets link.")
    gid = _GID.search(url)
    return match.group(1), int(gid.group(1)) if gid else None


def parse_form_url(url: str) -> str:
    if _RESPONDER_FORM.search(url):
        raise ImportSourceError(
            "Paste the form's edit link (the one ending in /edit), not the link you send "
            "respondents."
        )
    match = _FORM_ID.search(url)
    if not match:
        raise ImportSourceError("That isn't a Google Forms link.")
    return match.group(1)


def _service_account_info() -> dict[str, Any]:
    settings = get_settings()
    try:
        if settings.google_service_account_json:
            return json.loads(settings.google_service_account_json)
        with open(settings.google_service_account_file, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        raise ImportSourceError("Google Sheets imports aren't set up on this server.") from e


def service_account_email() -> str:
    """The address TDs share their sheet and form with."""
    return _service_account_info()["client_email"]


# ---------------------------------------------------------------------------
# Sheets
# ---------------------------------------------------------------------------


def _serial_to_datetime(serial: float, timezone: str) -> datetime:
    return (_SERIAL_EPOCH + timedelta(days=serial)).replace(tzinfo=ZoneInfo(timezone))


def table_from_grid(spreadsheet: dict[str, Any]) -> SourceTable:
    """Builds the table from a spreadsheets.get response with grid data for one tab. A date or
    time cell keeps its displayed text and gets its moment from the serial number, read in the
    spreadsheet's own timezone."""
    timezone = spreadsheet.get("properties", {}).get("timeZone") or "UTC"
    sheet = spreadsheet["sheets"][0]
    raw_rows: list[list[Cell]] = []
    for grid in sheet.get("data", []):
        for row in grid.get("rowData", []):
            cells = []
            for value in row.get("values", []):
                text = (value.get("formattedValue") or "").strip()
                number = value.get("effectiveValue", {}).get("numberValue")
                kind = value.get("effectiveFormat", {}).get("numberFormat", {}).get("type")
                when = (
                    _serial_to_datetime(number, timezone)
                    if number is not None and kind in ("DATE", "DATE_TIME")
                    else None
                )
                cells.append(Cell(text, when=when))
            raw_rows.append(cells)
    return build_table(raw_rows)


@dataclass(frozen=True)
class SheetTab:
    gid: int
    title: str


# ---------------------------------------------------------------------------
# Forms
# ---------------------------------------------------------------------------

QuestionKind = Literal[
    "short_text",
    "long_text",
    "radio",
    "checkbox",
    "dropdown",
    "scale",
    "date",
    "time",
    "grid_radio",
    "grid_checkbox",
]


@dataclass(frozen=True)
class GoogleQuestion:
    """One Google Form question, in the order the form asks it. `options` are the choice
    labels (a grid's column labels, a scale's numbers); `rows` are a grid's row labels."""

    title: str
    kind: QuestionKind
    description: str | None = None
    required: bool = False
    options: list[str] = field(default_factory=list)
    rows: list[str] = field(default_factory=list)
    has_other: bool = False


@dataclass(frozen=True)
class GoogleForm:
    title: str
    questions: list[GoogleQuestion]


_CHOICE_KINDS: dict[str, QuestionKind] = {
    "RADIO": "radio",
    "CHECKBOX": "checkbox",
    "DROP_DOWN": "dropdown",
}


def _question(title: str, description: str | None, question: dict[str, Any]) -> GoogleQuestion:
    def make(kind: QuestionKind, options: list[str] | None = None, has_other: bool = False):
        return GoogleQuestion(
            title=title,
            kind=kind,
            description=description,
            required=bool(question.get("required")),
            options=options or [],
            has_other=has_other,
        )

    if "choiceQuestion" in question:
        choice = question["choiceQuestion"]
        options = choice.get("options", [])
        return make(
            _CHOICE_KINDS.get(choice.get("type", ""), "radio"),
            [o["value"] for o in options if not o.get("isOther") and "value" in o],
            any(o.get("isOther") for o in options),
        )
    if "scaleQuestion" in question:
        scale = question["scaleQuestion"]
        low, high = scale.get("low", 1), scale.get("high", 5)
        return make("scale", [str(n) for n in range(low, high + 1)])
    if "ratingQuestion" in question:
        levels = question["ratingQuestion"].get("ratingScaleLevel", 5)
        return make("scale", [str(n) for n in range(1, levels + 1)])
    if "dateQuestion" in question:
        return make("date")
    if "timeQuestion" in question:
        return make("time")
    paragraph = question.get("textQuestion", {}).get("paragraph", False)
    # File uploads land in the sheet as Drive links, so they read as text too.
    return make("long_text" if paragraph else "short_text")


def form_from_api(form: dict[str, Any]) -> GoogleForm:
    """Builds the questions from a forms.get response, skipping section headers, page breaks,
    images and videos."""
    questions: list[GoogleQuestion] = []
    for item in form.get("items", []):
        title = item.get("title", "")
        description = item.get("description")
        if "questionItem" in item:
            questions.append(_question(title, description, item["questionItem"]["question"]))
        elif "questionGroupItem" in item:
            group = item["questionGroupItem"]
            columns = group.get("grid", {}).get("columns", {})
            questions.append(
                GoogleQuestion(
                    title=title,
                    description=description,
                    kind="grid_checkbox" if columns.get("type") == "CHECKBOX" else "grid_radio",
                    required=any(q.get("required") for q in group.get("questions", [])),
                    options=[o["value"] for o in columns.get("options", []) if "value" in o],
                    rows=[
                        q.get("rowQuestion", {}).get("title", "")
                        for q in group.get("questions", [])
                    ],
                )
            )
    return GoogleForm(title=form.get("info", {}).get("title", ""), questions=questions)


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class GoogleImportClient:
    """Connects on first use, so a server without Google credentials can still take uploads."""

    @cached_property
    def _credentials(self):
        return service_account.Credentials.from_service_account_info(
            _service_account_info(), scopes=SCOPES
        )

    @cached_property
    def _sheets(self):
        return build("sheets", "v4", credentials=self._credentials, cache_discovery=False)

    @cached_property
    def _forms(self):
        return build("forms", "v1", credentials=self._credentials, cache_discovery=False)

    def _not_readable(self, e: HttpError, what: str) -> ImportSourceError:
        if e.resp.status in (403, 404):
            return ImportSourceError(
                f"NEXUS can't open that {what}. Check the link, and share the {what} with "
                f"{service_account_email()} as a viewer."
            )
        return ImportSourceError(f"Google couldn't return the {what}. Try again in a moment.")

    def sheet_tabs(self, spreadsheet_id: str) -> list[SheetTab]:
        try:
            response = (
                self._sheets.spreadsheets()
                .get(spreadsheetId=spreadsheet_id, fields="sheets.properties(sheetId,title)")
                .execute()
            )
        except HttpError as e:
            raise self._not_readable(e, "sheet") from e
        return [
            SheetTab(gid=s["properties"]["sheetId"], title=s["properties"]["title"])
            for s in response.get("sheets", [])
        ]

    def sheet_table(self, spreadsheet_id: str, tab: str) -> SourceTable:
        quoted = "'" + tab.replace("'", "''") + "'"
        try:
            response = (
                self._sheets.spreadsheets()
                .get(
                    spreadsheetId=spreadsheet_id,
                    ranges=[quoted],
                    includeGridData=True,
                    fields=(
                        "properties.timeZone,sheets.data.rowData.values("
                        "formattedValue,effectiveValue,effectiveFormat.numberFormat.type)"
                    ),
                )
                .execute()
            )
        except HttpError as e:
            raise self._not_readable(e, "sheet") from e
        return table_from_grid(response)

    def form(self, form_id: str) -> GoogleForm:
        try:
            response = self._forms.forms().get(formId=form_id).execute()
        except HttpError as e:
            raise self._not_readable(e, "form") from e
        return form_from_api(response)
