"""Unit tests for SheetsService — all Google API calls are mocked."""

import pytest
from unittest.mock import MagicMock, patch
from app.services.sheets_service import (
    SheetsService,
    _build_question_index,
    _match_header_to_question,
    _question_to_mapping,
    _alias_rules,
    _slugify,
)
from app.schemas.sheet_config import (
    ColumnMapping,
    FormQuestion,
    FormQuestionOption,
)


@pytest.fixture
def svc() -> SheetsService:
    with patch("app.services.sheets_service.service_account"), \
         patch("app.services.sheets_service.build"):
        return SheetsService()


# ---------------------------------------------------------------------------
# extract_spreadsheet_id
# ---------------------------------------------------------------------------

def test_extract_spreadsheet_id(svc: SheetsService):
    url = "https://docs.google.com/spreadsheets/d/abc123XYZ/edit#gid=0"
    assert svc.extract_spreadsheet_id(url) == "abc123XYZ"


def test_extract_spreadsheet_id_invalid(svc: SheetsService):
    with pytest.raises(ValueError):
        svc.extract_spreadsheet_id("https://example.com/not-a-sheet")


# ---------------------------------------------------------------------------
# _detect_field — header hint fallback
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("header,expected_field,expected_type,expected_row_key", [
    # Identity
    ("Email Address",       "email",        "string",       None),
    ("email",               "email",        "string",       None),
    ("First Name",          "first_name",   "string",       None),
    ("Last Name",           "last_name",    "string",       None),
    ("Phone Number",        "phone",        "string",       None),
    ("T-Shirt Size",        "shirt_size",   "string",       None),
    ("Dietary Restrictions","dietary_restriction", "string", None),
    # Role & preference
    ("Volunteering Role Preference", "role_preference", "multi_select", None),
    ("Which event would you like?",  "event_preference", "multi_select", None),
    ("General Volunteer Interest",   "extra_data", "multi_select", None),
    # Logistics
    ("Lunch Order",         "lunch_order",  "string",       None),
    ("Additional Notes",    "notes",        "string",       None),
    # Ignore
    ("Timestamp",           "__ignore__",   "ignore",       None),
    # Unknown → ignore
    ("Some Random Column",  "__ignore__",   "ignore",       None),
    # Availability matrix rows — real forms have extra spaces
    ("Availability [8:00 AM - 10:00 AM]",
        "availability", "matrix_row", "8:00 AM - 10:00 AM"),
    ("Availability from 5/21 to 5/23 [8:00 AM  - 10:00 AM]",
        "availability", "matrix_row", "8:00 AM  - 10:00 AM"),
    ("Availability from 5/21 to 5/23 [10:00 AM  -  NOON]",
        "availability", "matrix_row", "10:00 AM  -  NOON"),
])
def test_detect_field(svc, header, expected_field, expected_type, expected_row_key):
    result = svc._detect_field(header)
    assert isinstance(result, ColumnMapping)
    assert result.field == expected_field
    assert result.type == expected_type
    assert result.row_key == expected_row_key


# ---------------------------------------------------------------------------
# get_headers — no form questions (events sheet / fallback path)
# ---------------------------------------------------------------------------

def test_get_headers_no_form_questions(svc: SheetsService):
    svc._client.spreadsheets().values().get().execute.return_value = {
        "values": [["Email Address", "First Name", "Timestamp"]]
    }
    result = svc.get_headers(
        sheet_url="https://docs.google.com/spreadsheets/d/abc/edit",
        sheet_name="Sheet1",
        sheet_type="volunteers",
        form_questions=None,
    )
    assert result.sheet_type == "volunteers"
    assert result.form_questions is None
    assert result.suggestions["Email Address"].field == "email"
    assert result.suggestions["First Name"].field == "first_name"
    assert result.suggestions["Timestamp"].type == "ignore"


def test_get_headers_events_sheet(svc: SheetsService):
    svc._client.spreadsheets().values().get().execute.return_value = {
        "values": [["Event Name", "Division"]]
    }
    result = svc.get_headers(
        sheet_url="https://docs.google.com/spreadsheets/d/abc/edit",
        sheet_name="Sheet1",
        sheet_type="events",
        form_questions=None,
    )
    assert result.sheet_type == "events"
    assert result.form_questions is None
    # Events sheet gets EVENT_KNOWN_FIELDS scoped list
    assert "email" not in result.known_fields


# ---------------------------------------------------------------------------
# get_headers — with form questions (volunteers sheet)
# ---------------------------------------------------------------------------

def test_get_headers_with_form_questions_uses_form_type(svc: SheetsService):
    """Form question type takes priority over header hint type."""
    svc._client.spreadsheets().values().get().execute.return_value = {
        "values": [["Which events are you interested in supervising?"]]
    }
    questions = [
        FormQuestion(
            question_id="q1",
            title="Which events are you interested in supervising?",
            nexus_type="multi_select",
            options=[
                FormQuestionOption(raw="Anatomy - Study body", alias="Anatomy"),
                FormQuestionOption(raw="Chemistry Lab", alias="Chemistry Lab"),
            ],
        )
    ]
    result = svc.get_headers(
        sheet_url="https://docs.google.com/spreadsheets/d/abc/edit",
        sheet_name="Sheet1",
        sheet_type="volunteers",
        form_questions=questions,
    )
    mapping = result.suggestions["Which events are you interested in supervising?"]
    assert mapping.type == "multi_select"
    assert mapping.field == "event_preference"
    # Should have a replace rule for the option with a different alias
    assert mapping.rules is not None
    assert any(r.action == "replace" and r.match == "Anatomy - Study body" for r in mapping.rules)
    # Options that didn't change should not produce rules
    assert not any(r.match == "Chemistry Lab" for r in mapping.rules)


def test_get_headers_with_form_questions_grid_gets_parse_availability(svc: SheetsService):
    """Grid question columns → matrix_row with parse_availability rule auto-attached."""
    svc._client.spreadsheets().values().get().execute.return_value = {
        "values": [["Availability [8:00 AM - 10:00 AM]", "Availability [10:00 AM - 12:00 PM]"]]
    }
    questions = [
        FormQuestion(
            question_id="q2",
            title="Availability",
            nexus_type="matrix_row",
            grid_rows=["8:00 AM - 10:00 AM", "10:00 AM - 12:00 PM"],
            grid_columns=["Available", "Maybe"],
        )
    ]
    result = svc.get_headers(
        sheet_url="https://docs.google.com/spreadsheets/d/abc/edit",
        sheet_name="Sheet1",
        sheet_type="volunteers",
        form_questions=questions,
    )
    for header in ["Availability [8:00 AM - 10:00 AM]", "Availability [10:00 AM - 12:00 PM]"]:
        mapping = result.suggestions[header]
        assert mapping.type == "matrix_row"
        assert mapping.field == "availability"
        assert mapping.rules is not None
        assert any(r.action == "parse_availability" for r in mapping.rules)

    assert result.suggestions["Availability [8:00 AM - 10:00 AM]"].row_key == "8:00 AM - 10:00 AM"
    assert result.suggestions["Availability [10:00 AM - 12:00 PM]"].row_key == "10:00 AM - 12:00 PM"


def test_get_headers_unmatched_column_falls_back_to_hint(svc: SheetsService):
    """Columns with no matching form question fall back to header hint detection."""
    svc._client.spreadsheets().values().get().execute.return_value = {
        "values": [["Email Address", "Some Unknown Column"]]
    }
    questions = [
        FormQuestion(question_id="q1", title="Email Address", nexus_type="string")
    ]
    result = svc.get_headers(
        sheet_url="https://docs.google.com/spreadsheets/d/abc/edit",
        sheet_name="Sheet1",
        sheet_type="volunteers",
        form_questions=questions,
    )
    assert result.suggestions["Email Address"].field == "email"
    assert result.suggestions["Some Unknown Column"].type == "ignore"


def test_get_headers_passes_form_questions_through_to_response(svc: SheetsService):
    """form_questions from the service layer are included in the response."""
    svc._client.spreadsheets().values().get().execute.return_value = {
        "values": [["Email Address"]]
    }
    questions = [
        FormQuestion(question_id="q1", title="Email Address", nexus_type="string")
    ]
    result = svc.get_headers(
        sheet_url="https://docs.google.com/spreadsheets/d/abc/edit",
        sheet_name="Sheet1",
        sheet_type="volunteers",
        form_questions=questions,
    )
    assert result.form_questions == questions


# ---------------------------------------------------------------------------
# _build_question_index
# ---------------------------------------------------------------------------

def test_build_question_index_exact():
    q = FormQuestion(question_id="q1", title="Email Address", nexus_type="string")
    index = _build_question_index([q])
    assert "email address" in index
    assert index["email address"] is q


def test_build_question_index_grid_rows():
    q = FormQuestion(
        question_id="q2",
        title="Availability",
        nexus_type="matrix_row",
        grid_rows=["8:00 AM - 10:00 AM", "10:00 AM - 12:00 PM"],
    )
    index = _build_question_index([q])
    assert "availability [8:00 am - 10:00 am]" in index
    assert "availability [10:00 am - 12:00 pm]" in index


# ---------------------------------------------------------------------------
# _match_header_to_question
# ---------------------------------------------------------------------------

def test_match_header_exact():
    q = FormQuestion(question_id="q1", title="First Name", nexus_type="string")
    index = _build_question_index([q])
    assert _match_header_to_question("First Name", index) is q


def test_match_header_case_insensitive():
    q = FormQuestion(question_id="q1", title="First Name", nexus_type="string")
    index = _build_question_index([q])
    assert _match_header_to_question("first name", index) is q


def test_match_header_prefix():
    """Sheet header starts with question title — Google truncation case."""
    q = FormQuestion(question_id="q1", title="What is your shirt size", nexus_type="string")
    index = _build_question_index([q])
    assert _match_header_to_question("What is your shirt size (XS, S, M, L, XL)", index) is q


def test_match_header_no_match():
    q = FormQuestion(question_id="q1", title="First Name", nexus_type="string")
    index = _build_question_index([q])
    assert _match_header_to_question("Completely Unrelated", index) is None


# ---------------------------------------------------------------------------
# _alias_rules
# ---------------------------------------------------------------------------

def test_alias_rules_generates_replace_for_changed_options():
    q = FormQuestion(
        question_id="q1",
        title="Events",
        nexus_type="multi_select",
        options=[
            FormQuestionOption(raw="Anatomy - Study body", alias="Anatomy"),
            FormQuestionOption(raw="Chemistry Lab", alias="Chemistry Lab"),  # unchanged
        ],
    )
    rules = _alias_rules(q)
    assert len(rules) == 1
    assert rules[0].condition == "contains"
    assert rules[0].match == "Anatomy - Study body"
    assert rules[0].action == "replace"
    assert rules[0].value == "Anatomy"


def test_alias_rules_empty_when_no_options():
    q = FormQuestion(question_id="q1", title="Name", nexus_type="string")
    assert _alias_rules(q) == []


def test_alias_rules_empty_when_all_aliases_match():
    q = FormQuestion(
        question_id="q1",
        title="Events",
        nexus_type="multi_select",
        options=[
            FormQuestionOption(raw="Option A", alias="Option A"),
            FormQuestionOption(raw="Option B", alias="Option B"),
        ],
    )
    assert _alias_rules(q) == []


# ---------------------------------------------------------------------------
# _slugify
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("title,expected", [
    ("First Name",                  "first_name"),
    ("What is your shirt size?",    "what_is_your_shirt_size"),
    ("Do you have a conflict of interest?", "do_you_have_a_conflict_of_interest"),
    ("What is your experience with Science Olympiad competitions", "what_is_your_experience_with_science_olympiad_comp")  # capped at 50
])
def test_slugify(title, expected):
    assert _slugify(title) == expected


# ---------------------------------------------------------------------------
# get_rows
# ---------------------------------------------------------------------------

def test_get_rows(svc: SheetsService):
    mock_response = {
        "values": [
            ["Email", "First Name", "Last Name"],
            ["alice@example.com", "Alice", "Smith"],
            ["bob@example.com", "Bob", ""],
        ]
    }
    svc._client.spreadsheets().values().get().execute.return_value = mock_response
    rows = svc.get_rows("spreadsheet123", "Sheet1")
    assert len(rows) == 2
    assert rows[0]["Email"] == "alice@example.com"
    assert rows[1]["Last Name"] == ""


def test_get_rows_short_row_padded(svc: SheetsService):
    """Rows shorter than headers should be padded with empty strings."""
    mock_response = {
        "values": [
            ["Email", "First Name", "Last Name", "Phone"],
            ["alice@example.com", "Alice"],  # missing last name + phone
        ]
    }
    svc._client.spreadsheets().values().get().execute.return_value = mock_response
    rows = svc.get_rows("spreadsheet123", "Sheet1")
    assert rows[0]["Last Name"] == ""
    assert rows[0]["Phone"] == ""


def test_get_rows_empty_sheet(svc: SheetsService):
    svc._client.spreadsheets().values().get().execute.return_value = {"values": []}
    rows = svc.get_rows("spreadsheet123", "Sheet1")
    assert rows == []