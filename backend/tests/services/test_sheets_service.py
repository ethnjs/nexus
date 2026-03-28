"""Unit tests for SheetsService and pure helper functions — all Google API calls are mocked."""

import pytest
from unittest.mock import patch
from app.services.sheets_service import (
    SheetsService,
    _build_question_index,
    _match_question,
    _extract_row_key,
    _hint_from_title,
    _alias_rules,
    _slugify,
    _dedup,
    _mapped_from_hint,
)
from app.schemas.sheet_config import (
    FormQuestionOption,
    MappedHeader,
    PARSE_TIME_RANGE_ACTIONS,
)

FAKE_URL = "https://docs.google.com/spreadsheets/d/abc123/edit"


@pytest.fixture
def svc() -> SheetsService:
    with patch("app.services.sheets_service.service_account"), \
         patch("app.services.sheets_service.build"):
        return SheetsService()


def _mock_headers(svc: SheetsService, headers: list[str]) -> None:
    svc._client.spreadsheets().values().get().execute.return_value = {
        "values": [headers]
    }


def _by_header(result, header: str) -> MappedHeader:
    """Look up a MappedHeader from a SheetHeadersResponse by header string."""
    for m in result.mappings:
        if m.header == header:
            return m
    raise KeyError(f"No mapping found for header: {header!r}")


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
# get_headers — flat mappings list, no form questions
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("header,expected_field,expected_type,expected_row_key", [
    # Identity
    ("Email Address",        "email",               "string",     None),
    ("email",                "email",               "string",     None),
    ("First Name",           "first_name",          "string",     None),
    ("Last Name",            "last_name",           "string",     None),
    ("Phone Number",         "phone",               "string",     None),
    ("T-Shirt Size",         "shirt_size",          "string",     None),
    ("Dietary Restrictions", "dietary_restriction", "string",     None),
    # Role & preference
    ("Volunteering Role Preference", "role_preference",  "multi_select", None),
    ("Which event would you like?",  "event_preference", "multi_select", None),
    # Logistics
    ("Lunch Order",          "lunch_order",         "string",     None),
    ("Additional Notes",     "notes",               "string",     None),
    # Ignore
    ("Timestamp",            "__ignore__",          "ignore",     None),
    ("Some Random Column",   "__ignore__",          "ignore",     None),
    # Availability matrix rows
    ("Availability [8:00 AM - 10:00 AM]",
        "availability", "matrix_row", "8:00 AM - 10:00 AM"),
    ("Availability from 5/21 to 5/23 [8:00 AM  - 10:00 AM]",
        "availability", "matrix_row", "8:00 AM  - 10:00 AM"),
    ("Availability from 5/21 to 5/23 [10:00 AM  -  NOON]",
        "availability", "matrix_row", "10:00 AM  -  NOON"),
])
def test_hint_detection(svc, header, expected_field, expected_type, expected_row_key):
    """Hint-based detection via get_headers with no form questions."""
    _mock_headers(svc, [header])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    m = _by_header(result, header)
    assert m.field == expected_field
    assert m.type == expected_type
    assert m.row_key == expected_row_key


def test_get_headers_returns_mappings_list(svc: SheetsService):
    """Response has a flat mappings list, one entry per column."""
    _mock_headers(svc, ["Email Address", "First Name", "Timestamp"])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    assert result.sheet_type == "volunteers"
    assert len(result.mappings) == 3
    assert all(isinstance(m, MappedHeader) for m in result.mappings)
    assert _by_header(result, "Email Address").field == "email"
    assert _by_header(result, "First Name").field == "first_name"
    assert _by_header(result, "Timestamp").type == "ignore"


def test_get_headers_preserves_column_order(svc: SheetsService):
    headers = ["Timestamp", "Email Address", "First Name", "Last Name"]
    _mock_headers(svc, headers)
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    assert [m.header for m in result.mappings] == headers


def test_get_headers_events_sheet_scopes_known_fields(svc: SheetsService):
    _mock_headers(svc, ["Event Name", "Division"])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="events")
    assert result.sheet_type == "events"
    assert "email" not in result.known_fields


# ---------------------------------------------------------------------------
# get_headers — deduplication
# ---------------------------------------------------------------------------

def test_dedup_second_email_becomes_ignore(svc: SheetsService):
    """Two columns matching 'email' — second one falls back to ignore."""
    _mock_headers(svc, ["Email Address", "email"])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    first  = _by_header(result, "Email Address")
    second = _by_header(result, "email")
    assert first.field == "email"
    assert second.field == "__ignore__"
    assert second.type == "ignore"


def test_dedup_availability_allows_multiple_matrix_rows(svc: SheetsService):
    """Multiple availability columns are all allowed — availability is exempt from dedup."""
    _mock_headers(svc, [
        "Availability [8:00 AM - 10:00 AM]",
        "Availability [10:00 AM - 12:00 PM]",
        "Availability [12:00 PM - 2:00 PM]",
    ])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    for m in result.mappings:
        assert m.field == "availability"
        assert m.type == "matrix_row"


def test_dedup_extra_key_collision_becomes_ignore(svc: SheetsService):
    """Two extra_data columns with the same slugified key — second becomes ignore."""
    # Both "competed in the past" and "competed in science" slug to scioly_competed
    _mock_headers(svc, [
        "Have you competed in the past?",
        "Have you competed in science olympiad?",
    ])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    fields = [m.field for m in result.mappings]
    # At most one should claim extra_data with scioly_competed key
    extra = [m for m in result.mappings if m.field == "extra_data" and m.extra_key == "scioly_competed"]
    assert len(extra) <= 1


# ---------------------------------------------------------------------------
# get_headers — parse_time_range auto-attachment
# ---------------------------------------------------------------------------

def test_hint_availability_gets_parse_time_range(svc: SheetsService):
    """Hint-matched availability rows get parse_time_range rule auto-attached."""
    _mock_headers(svc, ["Availability [8:00 AM - 10:00 AM]"])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    m = _by_header(result, "Availability [8:00 AM - 10:00 AM]")
    assert m.rules is not None
    assert any(r.action in PARSE_TIME_RANGE_ACTIONS for r in m.rules)


# ---------------------------------------------------------------------------
# get_headers — with form questions (plain dicts from FormsService)
# ---------------------------------------------------------------------------

def _make_text_q(qid: str, title: str) -> dict:
    return {"question_id": qid, "title": title, "google_type": "TEXT",
            "nexus_type": "string", "options": None, "grid_rows": None, "grid_columns": None}


def _make_checkbox_q(qid: str, title: str, options: list[FormQuestionOption]) -> dict:
    return {"question_id": qid, "title": title, "google_type": "CHECKBOX",
            "nexus_type": "multi_select", "options": options, "grid_rows": None, "grid_columns": None}


def _make_grid_q(qid: str, title: str, rows: list[str], cols: list[str]) -> dict:
    return {"question_id": qid, "title": title, "google_type": "GRID",
            "nexus_type": "matrix_row", "options": None, "grid_rows": rows, "grid_columns": cols}


def test_form_question_type_takes_priority_over_hint(svc: SheetsService):
    """Form question nexus_type overrides hint-based type detection."""
    _mock_headers(svc, ["Which events are you interested in supervising?"])
    questions = [_make_checkbox_q(
        "q1",
        "Which events are you interested in supervising?",
        [
            FormQuestionOption(raw="Anatomy - Study body", alias="Anatomy"),
            FormQuestionOption(raw="Chemistry Lab", alias="Chemistry Lab"),
        ],
    )]
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers", form_questions=questions)
    m = _by_header(result, "Which events are you interested in supervising?")
    assert m.type == "multi_select"
    assert m.field == "event_preference"
    assert m.google_type == "CHECKBOX"
    assert m.rules is not None
    assert any(r.action == "replace" and r.match == "Anatomy - Study body" for r in m.rules)
    assert not any(r.match == "Chemistry Lab" for r in m.rules)


def test_form_grid_gets_parse_time_range_and_row_key(svc: SheetsService):
    """Grid question columns get matrix_row type, row_key, and parse_time_range rule."""
    _mock_headers(svc, [
        "Availability [8:00 AM - 10:00 AM]",
        "Availability [10:00 AM - 12:00 PM]",
    ])
    questions = [_make_grid_q(
        "q2", "Availability",
        rows=["8:00 AM - 10:00 AM", "10:00 AM - 12:00 PM"],
        cols=["Available", "Maybe"],
    )]
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers", form_questions=questions)
    for header, expected_key in [
        ("Availability [8:00 AM - 10:00 AM]",  "8:00 AM - 10:00 AM"),
        ("Availability [10:00 AM - 12:00 PM]", "10:00 AM - 12:00 PM"),
    ]:
        m = _by_header(result, header)
        assert m.type == "matrix_row"
        assert m.field == "availability"
        assert m.row_key == expected_key
        assert m.google_type == "GRID"
        assert m.rules is not None
        assert any(r.action in PARSE_TIME_RANGE_ACTIONS for r in m.rules)


def test_form_google_type_passed_through(svc: SheetsService):
    """google_type from the question dict is surfaced on MappedHeader."""
    _mock_headers(svc, ["Email Address"])
    questions = [_make_text_q("q1", "Email Address")]
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers", form_questions=questions)
    m = _by_header(result, "Email Address")
    assert m.google_type == "TEXT"


def test_unmatched_column_falls_back_to_hint(svc: SheetsService):
    """Headers with no matching form question fall back to hint detection."""
    _mock_headers(svc, ["Email Address", "Some Unknown Column"])
    questions = [_make_text_q("q1", "Email Address")]
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers", form_questions=questions)
    assert _by_header(result, "Email Address").field == "email"
    assert _by_header(result, "Some Unknown Column").type == "ignore"


def test_form_dedup_second_email_becomes_ignore(svc: SheetsService):
    """Dedup still fires when mapping comes from form questions."""
    _mock_headers(svc, ["Email Address", "Email (confirm)"])
    questions = [
        _make_text_q("q1", "Email Address"),
        _make_text_q("q2", "Email (confirm)"),
    ]
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers", form_questions=questions)
    first  = _by_header(result, "Email Address")
    second = _by_header(result, "Email (confirm)")
    assert first.field == "email"
    # second gets hint → also email → deduped to ignore
    assert second.field == "__ignore__"


# ---------------------------------------------------------------------------
# _build_question_index
# ---------------------------------------------------------------------------

def test_build_question_index_exact():
    q = _make_text_q("q1", "Email Address")
    index = _build_question_index([q])
    assert "email address" in index
    assert index["email address"] is q


def test_build_question_index_grid_rows():
    q = _make_grid_q("q2", "Availability",
                     rows=["8:00 AM - 10:00 AM", "10:00 AM - 12:00 PM"], cols=[])
    index = _build_question_index([q])
    assert "availability [8:00 am - 10:00 am]" in index
    assert "availability [10:00 am - 12:00 pm]" in index


# ---------------------------------------------------------------------------
# _match_question
# ---------------------------------------------------------------------------

def test_match_question_exact():
    q = _make_text_q("q1", "First Name")
    index = _build_question_index([q])
    assert _match_question("first name", index) is q


def test_match_question_prefix():
    """Sheet header starts with question title — Google truncation case."""
    q = _make_text_q("q1", "What is your shirt size")
    index = _build_question_index([q])
    assert _match_question("what is your shirt size (xs, s, m, l, xl)", index) is q


def test_match_question_no_match():
    q = _make_text_q("q1", "First Name")
    index = _build_question_index([q])
    assert _match_question("completely unrelated", index) is None


# ---------------------------------------------------------------------------
# _extract_row_key
# ---------------------------------------------------------------------------

def test_extract_row_key_bracket():
    assert _extract_row_key("Availability [8:00 AM - 10:00 AM]") == "8:00 AM - 10:00 AM"


def test_extract_row_key_fallback():
    assert _extract_row_key("No brackets here") == "No brackets here"


# ---------------------------------------------------------------------------
# _hint_from_title
# ---------------------------------------------------------------------------

def test_hint_from_title_known():
    field, t = _hint_from_title("Email Address")
    assert field == "email"
    assert t == "string"


def test_hint_from_title_unknown():
    field, t = _hint_from_title("Some Obscure Column")
    assert field == "extra_data"
    assert t == "string"


# ---------------------------------------------------------------------------
# _alias_rules
# ---------------------------------------------------------------------------

def test_alias_rules_generates_replace_for_changed_options():
    options = [
        FormQuestionOption(raw="Anatomy - Study body", alias="Anatomy"),
        FormQuestionOption(raw="Chemistry Lab", alias="Chemistry Lab"),  # unchanged
    ]
    rules = _alias_rules(options)
    assert len(rules) == 1
    assert rules[0].condition == "contains"
    assert rules[0].match == "Anatomy - Study body"
    assert rules[0].action == "replace"
    assert rules[0].value == "Anatomy"


def test_alias_rules_empty_when_no_options():
    assert _alias_rules([]) == []


def test_alias_rules_empty_when_all_aliases_match():
    options = [
        FormQuestionOption(raw="Option A", alias="Option A"),
        FormQuestionOption(raw="Option B", alias="Option B"),
    ]
    assert _alias_rules(options) == []


# ---------------------------------------------------------------------------
# _slugify
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("title,expected", [
    ("First Name",                  "first_name"),
    ("What is your shirt size?",    "what_is_your_shirt_size"),
    ("Do you have a conflict of interest?", "do_you_have_a_conflict_of_interest"),
    ("What is your experience with Science Olympiad competitions",
     "what_is_your_experience_with_science_olympiad_comp"),  # capped at 50
])
def test_slugify(title, expected):
    assert _slugify(title) == expected


# ---------------------------------------------------------------------------
# _dedup
# ---------------------------------------------------------------------------

def test_dedup_claims_field_on_first_use():
    claimed_fields: set = set()
    claimed_keys: set = set()
    f, t, k = _dedup("email", "string", None, claimed_fields, claimed_keys)
    assert f == "email"
    assert "email" in claimed_fields


def test_dedup_second_use_falls_back():
    claimed_fields = {"email"}
    claimed_keys: set = set()
    f, t, k = _dedup("email", "string", None, claimed_fields, claimed_keys)
    assert f == "__ignore__"
    assert t == "ignore"


def test_dedup_ignore_never_claimed():
    claimed_fields: set = set()
    claimed_keys: set = set()
    _dedup("__ignore__", "ignore", None, claimed_fields, claimed_keys)
    _dedup("__ignore__", "ignore", None, claimed_fields, claimed_keys)
    assert "__ignore__" not in claimed_fields


def test_dedup_availability_never_claimed():
    claimed_fields: set = set()
    claimed_keys: set = set()
    _dedup("availability", "matrix_row", None, claimed_fields, claimed_keys)
    _dedup("availability", "matrix_row", None, claimed_fields, claimed_keys)
    assert "availability" not in claimed_fields


def test_dedup_extra_key_collision():
    claimed_fields: set = set()
    claimed_keys: set = set()
    f1, _, _ = _dedup("extra_data", "string", "my_key", claimed_fields, claimed_keys)
    f2, t2, _ = _dedup("extra_data", "string", "my_key", claimed_fields, claimed_keys)
    assert f1 == "extra_data"
    assert f2 == "__ignore__"
    assert t2 == "ignore"


# ---------------------------------------------------------------------------
# get_rows
# ---------------------------------------------------------------------------

def test_get_rows(svc: SheetsService):
    svc._client.spreadsheets().values().get().execute.return_value = {
        "values": [
            ["Email", "First Name", "Last Name"],
            ["alice@example.com", "Alice", "Smith"],
            ["bob@example.com", "Bob", ""],
        ]
    }
    rows = svc.get_rows("spreadsheet123", "Sheet1")
    assert len(rows) == 2
    assert rows[0]["Email"] == "alice@example.com"
    assert rows[1]["Last Name"] == ""


def test_get_rows_short_row_padded(svc: SheetsService):
    """Rows shorter than headers should be padded with empty strings."""
    svc._client.spreadsheets().values().get().execute.return_value = {
        "values": [
            ["Email", "First Name", "Last Name", "Phone"],
            ["alice@example.com", "Alice"],
        ]
    }
    rows = svc.get_rows("spreadsheet123", "Sheet1")
    assert rows[0]["Last Name"] == ""
    assert rows[0]["Phone"] == ""


def test_get_rows_empty_sheet(svc: SheetsService):
    svc._client.spreadsheets().values().get().execute.return_value = {"values": []}
    assert svc.get_rows("spreadsheet123", "Sheet1") == []