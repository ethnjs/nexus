from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.core.form.import_sources import ImportSourceError
from app.services.google_import import (
    GoogleQuestion,
    form_from_api,
    parse_form_url,
    parse_spreadsheet_url,
    table_from_grid,
)


def test_parse_spreadsheet_url():
    url = "https://docs.google.com/spreadsheets/d/1AbC-d_9/edit#gid=123"
    assert parse_spreadsheet_url(url) == ("1AbC-d_9", 123)
    assert parse_spreadsheet_url("https://docs.google.com/spreadsheets/d/1AbC/edit") == (
        "1AbC",
        None,
    )
    with pytest.raises(ImportSourceError):
        parse_spreadsheet_url("https://example.com/sheet")


def test_parse_form_url_needs_the_edit_link():
    assert parse_form_url("https://docs.google.com/forms/d/1FoRm_id/edit") == "1FoRm_id"
    with pytest.raises(ImportSourceError, match="edit link"):
        parse_form_url("https://docs.google.com/forms/d/e/1FAIpQ/viewform")


def test_table_from_grid_reads_dates_in_the_sheet_timezone():
    def cell(text, number=None, kind=None):
        value = {"formattedValue": text}
        if number is not None:
            value["effectiveValue"] = {"numberValue": number}
        if kind:
            value["effectiveFormat"] = {"numberFormat": {"type": kind}}
        return value

    response = {
        "properties": {"timeZone": "America/Los_Angeles"},
        "sheets": [
            {
                "data": [
                    {
                        "rowData": [
                            {"values": [cell("Timestamp"), cell("Age")]},
                            # 46339.5 is 2026-11-13 12:00 in the sheet's timezone.
                            {
                                "values": [
                                    cell("11/13/2026 12:00:00", 46339.5, "DATE_TIME"),
                                    cell("17", 17, "NUMBER"),
                                ]
                            },
                        ]
                    }
                ]
            }
        ],
    }
    table = table_from_grid(response)
    stamp, age = table.rows[0]
    assert stamp.text == "11/13/2026 12:00:00"
    assert stamp.when == datetime(2026, 11, 13, 12, tzinfo=ZoneInfo("America/Los_Angeles"))
    assert (age.text, age.when) == ("17", None)


def test_form_from_api_maps_each_question_kind():
    def item(title, question):
        return {"title": title, "questionItem": {"question": question}}

    form = form_from_api(
        {
            "info": {"title": "Volunteer interest"},
            "items": [
                {"title": "Section", "pageBreakItem": {}},
                item("Name", {"required": True, "textQuestion": {}}),
                item("Notes", {"textQuestion": {"paragraph": True}}),
                item(
                    "Shirt",
                    {
                        "choiceQuestion": {
                            "type": "DROP_DOWN",
                            "options": [{"value": "S"}, {"value": "M"}],
                        }
                    },
                ),
                item(
                    "Events",
                    {
                        "choiceQuestion": {
                            "type": "CHECKBOX",
                            "options": [{"value": "Anatomy"}, {"isOther": True}],
                        }
                    },
                ),
                item("Comfort", {"scaleQuestion": {"low": 1, "high": 3}}),
                item("Birthday", {"dateQuestion": {}}),
                {
                    "title": "Rank",
                    "questionGroupItem": {
                        "questions": [
                            {"required": True, "rowQuestion": {"title": "Anatomy"}},
                            {"rowQuestion": {"title": "Forensics"}},
                        ],
                        "grid": {"columns": {"type": "RADIO", "options": [{"value": "1st"}]}},
                    },
                },
            ],
        }
    )
    assert form.title == "Volunteer interest"
    assert form.questions == [
        GoogleQuestion(title="Name", kind="short_text", required=True),
        GoogleQuestion(title="Notes", kind="long_text"),
        GoogleQuestion(title="Shirt", kind="dropdown", options=["S", "M"]),
        GoogleQuestion(title="Events", kind="checkbox", options=["Anatomy"], has_other=True),
        GoogleQuestion(title="Comfort", kind="scale", options=["1", "2", "3"]),
        GoogleQuestion(title="Birthday", kind="date"),
        GoogleQuestion(
            title="Rank",
            kind="grid_radio",
            required=True,
            options=["1st"],
            rows=["Anatomy", "Forensics"],
        ),
    ]
