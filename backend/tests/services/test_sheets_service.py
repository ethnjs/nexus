"""Unit tests for SheetsService and pure helper functions — all Google API calls are mocked."""

import pytest
from unittest.mock import patch
from app.services.sheets_service import (
    SheetsService,
    _build_question_index,
    _match_question,
    _extract_row_key,
    _hint_field,
    _alias_rules,
    _slugify,
    _dedup,
    _is_lunch_header,
    _infer_lunch_row_key,
    _mapped_from_hint,
)
from app.services.volunteer_hints import (
    AVAILABILITY_BRACKET_PATTERN,
    FieldHint,
    match_volunteer_hint,
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
#
# Without form data, hints predict field only; type always defaults to "string"
# except for availability bracket pattern → "matrix_row".
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("header,expected_field,expected_type,expected_row_key", [
    # Identity
    ("Email Address",        "email",               "string",       None),
    ("email",                "email",               "string",       None),
    ("First Name",           "first_name",          "string",       None),
    ("Last Name",            "last_name",           "string",       None),
    ("First & Last Name",    "full_name",           "string",       None),
    ("Phone Number",         "phone",               "string",       None),
    ("T-Shirt Size",         "shirt_size",          "string",       None),
    ("Dietary Restrictions", "dietary_restriction",  "string",       None),
    # New user fields
    ("If you are a college student, what year are you in?",
                             "student_status",       "string",       None),
    ("I am a ...",           "student_status",       "string",       None),
    ("Have you competed in Science Olympiad in the past?",
                             "competition_exp",      "string",       None),
    ("Have you volunteered for past Science Olympiad competitions?",
                             "volunteering_exp",     "string",       None),
    # Role & preference — type defaults to "string" without form data
    ("Volunteering Role Preference", "role_preference",  "string", None),
    ("Event Preference",             "event_preference", "string", None),
    # Lunch
    ("Which protein do you want in your Chipotle burrito?",
                             "lunch_order",          "string",       None),
    ("What would you like to drink?",
                             "lunch_order",          "string",       None),
    ("Lunch Order",          "lunch_order",          "string",       None),
    # Notes
    ("Additional Notes",     "notes",               "string",       None),
    # Extra data with keys
    ("Where are you coming from?",  "extra_data",   "string",       None),
    ("Do you have any potential conflict of interests?",
                             "extra_data",           "string",       None),
    # Ignore
    ("Timestamp",            "__ignore__",          "ignore",       None),
    ("How did you hear about us?", "__ignore__",    "ignore",       None),
    ("Some Random Column",   "__ignore__",          "ignore",       None),
    # Availability matrix rows — bracket pattern forces matrix_row
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
# Hint extra_key tests
# ---------------------------------------------------------------------------

def test_hint_extra_key_conflict_of_interest(svc: SheetsService):
    """Conflict of interest maps to extra_data with key conflict_of_interest."""
    _mock_headers(svc, ["Do you have any potential conflict of interests?"])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    m = result.mappings[0]
    assert m.field == "extra_data"
    assert m.extra_key == "conflict_of_interest"


def test_hint_extra_key_transportation(svc: SheetsService):
    """Transportation question maps to extra_data with key transportation."""
    _mock_headers(svc, ["How will you get to the Nationals Tournament @ USC?"])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    m = result.mappings[0]
    assert m.field == "extra_data"
    assert m.extra_key == "transportation"


def test_hint_extra_key_location(svc: SheetsService):
    """Location question maps to extra_data with key location."""
    _mock_headers(svc, ["Which area will you be coming from?"])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    m = result.mappings[0]
    assert m.field == "extra_data"
    assert m.extra_key == "location"


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


def test_multi_lunch_upgrades_to_matrix_row(svc: SheetsService):
    """Two lunch-related columns are upgraded to matrix_row with inferred row_keys."""
    _mock_headers(svc, [
        "Which protein do you want?",
        "What would you like to drink?",
    ])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    first = result.mappings[0]
    second = result.mappings[1]
    assert first.field == "lunch_order"
    assert first.type == "matrix_row"
    assert first.row_key == "protein"
    assert second.field == "lunch_order"
    assert second.type == "matrix_row"
    assert second.row_key == "drink"


def test_multi_lunch_includes_options_from_form_questions(svc: SheetsService):
    """Multi-lunch matrix_row headers include options when form questions are provided."""
    protein_header = "Which protein do you want in your Chipotle burrito?"
    drink_header = "What would you like to drink?"
    questions = [
        _make_radio_q("q1", protein_header, [
            FormQuestionOption(raw="Chicken", alias="Chicken"),
            FormQuestionOption(raw="Steak", alias="Steak"),
        ]),
        _make_radio_q("q2", drink_header, [
            FormQuestionOption(raw="Water", alias="Water"),
            FormQuestionOption(raw="Lemonade", alias="Lemonade"),
        ]),
    ]
    _mock_headers(svc, [protein_header, drink_header])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers", form_questions=questions)
    protein = _by_header(result, protein_header)
    drink = _by_header(result, drink_header)
    assert protein.options is not None
    assert [o.raw for o in protein.options] == ["Chicken", "Steak"]
    assert drink.options is not None
    assert [o.raw for o in drink.options] == ["Water", "Lemonade"]


def test_single_lunch_stays_string(svc: SheetsService):
    """A single lunch header stays as string — no upgrade."""
    _mock_headers(svc, ["Lunch Order"])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    m = result.mappings[0]
    assert m.field == "lunch_order"
    assert m.type == "string"
    assert m.row_key is None


def test_dedup_extra_key_collision_becomes_ignore(svc: SheetsService):
    """Two extra_data columns with the same hint extra_key — second becomes ignore."""
    _mock_headers(svc, [
        "Where are you coming from?",
        "Which area will you be coming from?",
    ])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers")
    locations = [m for m in result.mappings if m.field == "extra_data" and m.extra_key == "location"]
    assert len(locations) == 1


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


def _make_radio_q(qid: str, title: str, options: list[FormQuestionOption]) -> dict:
    return {"question_id": qid, "title": title, "google_type": "MULTIPLE_CHOICE",
            "nexus_type": "string", "options": options, "grid_rows": None, "grid_columns": None}


def _make_grid_q(qid: str, title: str, rows: list[str], cols: list[str]) -> dict:
    return {"question_id": qid, "title": title, "google_type": "GRID",
            "nexus_type": "matrix_row", "options": None, "grid_rows": rows, "grid_columns": cols}


def _make_dropdown_q(qid: str, title: str, options: list[FormQuestionOption]) -> dict:
    return {"question_id": qid, "title": title, "google_type": "DROP_DOWN",
            "nexus_type": "string", "options": options, "grid_rows": None, "grid_columns": None}


def test_form_question_type_takes_priority(svc: SheetsService):
    """Form question nexus_type overrides default string type.
    Checkbox → multi_select even though hint alone would give string.
    """
    header = "If interested in event volunteering, which event(s) would you prefer helping with?"
    questions = [_make_checkbox_q(
        "q1",
        "If interested in event volunteering, which event(s) would you prefer helping with?",
        [
            FormQuestionOption(raw="Anatomy - Study body", alias="Anatomy"),
            FormQuestionOption(raw="Chemistry Lab", alias="Chemistry Lab"),
        ],
    )]
    _mock_headers(svc, [header])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers", form_questions=questions)
    m = _by_header(result, header)
    assert m.type == "multi_select"
    assert m.field == "event_preference"
    assert m.rules is not None
    assert any(r.action == "replace" and r.match == "Anatomy - Study body" for r in m.rules)
    assert not any(r.match == "Chemistry Lab" for r in m.rules)


def test_form_radio_maps_to_string(svc: SheetsService):
    """RADIO / MULTIPLE_CHOICE form type → string (single selection)."""
    header = "I am a ..."
    questions = [_make_radio_q("q1", "I am a ...", [
        FormQuestionOption(raw="UCI Undergraduate student", alias="UCI Undergraduate student"),
        FormQuestionOption(raw="UCI Graduate student", alias="UCI Graduate student"),
    ])]
    _mock_headers(svc, [header])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers", form_questions=questions)
    m = _by_header(result, header)
    assert m.type == "string"
    assert m.field == "student_status"


def test_form_dropdown_maps_to_string(svc: SheetsService):
    """DROP_DOWN form type → string."""
    header = "Current employer or university:"
    questions = [_make_dropdown_q("q1", "Current employer or university:", [
        FormQuestionOption(raw="USC", alias="USC"),
        FormQuestionOption(raw="UCLA", alias="UCLA"),
    ])]
    _mock_headers(svc, [header])
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers", form_questions=questions)
    m = _by_header(result, header)
    assert m.type == "string"
    assert m.field == "employer"


def test_form_availability_grid_gets_parse_time_range(svc: SheetsService):
    """Availability grid question columns get matrix_row type, row_key, and parse_time_range rule."""
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
        assert m.rules is not None
        assert any(r.action in PARSE_TIME_RANGE_ACTIONS for r in m.rules)


def test_form_event_preference_grid_no_parse_time_range(svc: SheetsService):
    """Event preference grid columns get matrix_row type but NO parse_time_range rule."""
    _mock_headers(svc, [
        "Please select the top 3 events [Anatomy and Physiology (B/C)]",
        "Please select the top 3 events [Forensics (C)]",
    ])
    questions = [_make_grid_q(
        "q3", "Please select the top 3 events",
        rows=["Anatomy and Physiology (B/C)", "Forensics (C)"],
        cols=["1st choice", "2nd choice", "3rd choice"],
    )]
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers", form_questions=questions)
    for m in result.mappings:
        assert m.type == "matrix_row"
        assert m.field == "event_preference"
        # Should NOT have parse_time_range rule
        if m.rules:
            assert not any(r.action in PARSE_TIME_RANGE_ACTIONS for r in m.rules)


def test_form_event_preference_grid_with_major_keyword_still_maps_event_preference(svc: SheetsService):
    """Long event grid titles containing 'major' should still map to event_preference."""
    title = (
        "Please select the top 3 events you would be interested in supervising. "
        "If you are new to Science Olympiad and are unsure about the events, you can read "
        "the event rules linked below or select \"assign me to an event based on my major "
        "or interests\" at the bottom of the list."
    )
    _mock_headers(svc, [
        f"{title} [Anatomy and Physiology (B/C)]",
        f"{title} [Forensics (C)]",
    ])
    questions = [_make_grid_q(
        "q3",
        title,
        rows=["Anatomy and Physiology (B/C)", "Forensics (C)"],
        cols=["1st choice", "2nd choice", "3rd choice"],
    )]

    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers", form_questions=questions)
    for m in result.mappings:
        assert m.type == "matrix_row"
        assert m.field == "event_preference"
        if m.rules:
            assert not any(r.action in PARSE_TIME_RANGE_ACTIONS for r in m.rules)


def test_form_no_google_type_on_mapped_header(svc: SheetsService):
    """MappedHeader should NOT have a google_type field."""
    _mock_headers(svc, ["Email Address"])
    questions = [_make_text_q("q1", "Email Address")]
    result = svc.get_headers(FAKE_URL, "Sheet1", sheet_type="volunteers", form_questions=questions)
    m = _by_header(result, "Email Address")
    assert not hasattr(m, "google_type") or m.model_dump().get("google_type") is None


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
    assert second.field == "__ignore__"


# ---------------------------------------------------------------------------
# volunteer_hints — match_volunteer_hint
# ---------------------------------------------------------------------------

def test_volunteer_hint_full_name():
    hint = match_volunteer_hint("first & last name")
    assert hint is not None
    assert hint.field == "full_name"


def test_volunteer_hint_student_status():
    hint = match_volunteer_hint("i am a ...")
    assert hint is not None
    assert hint.field == "student_status"


def test_volunteer_hint_competition_exp():
    hint = match_volunteer_hint("have you competed in the past?")
    assert hint is not None
    assert hint.field == "competition_exp"


def test_volunteer_hint_volunteering_exp():
    hint = match_volunteer_hint("have you volunteered for past science olympiad competitions?")
    assert hint is not None
    assert hint.field == "volunteering_exp"


def test_volunteer_hint_availability_catch_all():
    hint = match_volunteer_hint("will you be available for the full day?")
    assert hint is not None
    assert hint.field == "availability"


def test_volunteer_hint_event_preference_supervising():
    hint = match_volunteer_hint("if interested in event volunteering, which event(s)")
    assert hint is not None
    assert hint.field == "event_preference"


def test_volunteer_hint_confirmation():
    hint = match_volunteer_hint("i will volunteer for the oc regional")
    assert hint is not None
    assert hint.field == "extra_data"
    assert hint.extra_key == "confirmed"


def test_volunteer_hint_no_match():
    assert match_volunteer_hint("some completely random column") is None


def test_volunteer_hint_ignore():
    hint = match_volunteer_hint("timestamp")
    assert hint is not None
    assert hint.field == "__ignore__"


# ---------------------------------------------------------------------------
# _build_question_index
# ---------------------------------------------------------------------------

def test_build_question_index_exact():
    q = _make_text_q("q1", "Email Address")
    index = _build_question_index([q])
    assert "email address" in index
    assert index["email address"]["title"] == "Email Address"


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
    result = _match_question("first name", index)
    assert result is not None
    assert result["title"] == "First Name"


def test_match_question_prefix():
    """Sheet header starts with question title — Google truncation case."""
    q = _make_text_q("q1", "What is your shirt size")
    index = _build_question_index([q])
    result = _match_question("what is your shirt size (xs, s, m, l, xl)", index)
    assert result is not None
    assert result["title"] == "What is your shirt size"


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
# _hint_field
# ---------------------------------------------------------------------------

def test_hint_field_known():
    hint = _hint_field("Email Address")
    assert hint.field == "email"


def test_hint_field_unknown():
    hint = _hint_field("Some Obscure Column")
    assert hint.field == "extra_data"
    assert hint.extra_key is not None  # slugified


def test_hint_field_with_extra_key():
    hint = _hint_field("Do you have any potential conflict of interests?")
    assert hint.field == "extra_data"
    assert hint.extra_key == "conflict_of_interest"


# ---------------------------------------------------------------------------
# _alias_rules
# ---------------------------------------------------------------------------

def test_alias_rules_generates_replace_for_changed_options():
    options = [
        FormQuestionOption(raw="Anatomy - Study body", alias="Anatomy"),
        FormQuestionOption(raw="Chemistry Lab", alias="Chemistry Lab"),
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


def test_dedup_event_preference_never_claimed():
    """event_preference allows multiple entries (grid rows)."""
    claimed_fields: set = set()
    claimed_keys: set = set()
    _dedup("event_preference", "matrix_row", None, claimed_fields, claimed_keys)
    f, t, _ = _dedup("event_preference", "matrix_row", None, claimed_fields, claimed_keys)
    assert f == "event_preference"
    assert "event_preference" not in claimed_fields


def test_dedup_extra_key_collision():
    claimed_fields: set = set()
    claimed_keys: set = set()
    f1, _, _ = _dedup("extra_data", "string", "my_key", claimed_fields, claimed_keys)
    f2, t2, _ = _dedup("extra_data", "string", "my_key", claimed_fields, claimed_keys)
    assert f1 == "extra_data"
    assert f2 == "__ignore__"
    assert t2 == "ignore"


def test_dedup_any_matrix_row_field_never_claimed():
    """Any field with type=matrix_row is exempt from claiming — not just availability/event_preference."""
    claimed_fields: set = set()
    claimed_keys: set = set()
    f1, _, _ = _dedup("lunch_order", "matrix_row", None, claimed_fields, claimed_keys)
    f2, _, _ = _dedup("lunch_order", "matrix_row", None, claimed_fields, claimed_keys)
    assert f1 == "lunch_order"
    assert f2 == "lunch_order"
    assert "lunch_order" not in claimed_fields


# ---------------------------------------------------------------------------
# _is_lunch_header / _infer_lunch_row_key
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("header,expected", [
    ("Which protein do you want?",           True),
    ("What would you like to drink?",        True),
    ("Lunch Order",                          True),
    ("Meal preference",                      True),
    ("Entrée selection",                     True),
    ("Dessert choice",                       True),
    ("Email Address",                        False),
    ("First Name",                           False),
    ("Availability [8:00 AM - 10:00 AM]",   False),
])
def test_is_lunch_header(header, expected):
    assert _is_lunch_header(header.lower()) is expected


@pytest.mark.parametrize("header,expected_key", [
    ("Which protein do you want?",           "protein"),
    ("What would you like to drink?",        "drink"),
    ("Entrée selection",                     "entree"),
    ("Dessert choice",                       "dessert"),
    ("Meal preference",                      "meal"),
    ("Lunch Order",                          "lunch"),
    ("Some random lunch thing",              "lunch"),
])
def test_infer_lunch_row_key(header, expected_key):
    assert _infer_lunch_row_key(header) == expected_key


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
