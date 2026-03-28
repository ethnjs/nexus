"""Unit tests for FormsService — all Google API calls are mocked."""

import pytest
from unittest.mock import MagicMock, patch
from app.services.forms_service import FormsService, _suggest_alias


@pytest.fixture
def svc() -> FormsService:
    with patch("app.services.forms_service.service_account"), \
         patch("app.services.forms_service.build"):
        return FormsService()


def _make_form_response(items: list[dict]) -> dict:
    """Helper to build a minimal Forms API response."""
    return {"formId": "abc123", "info": {"title": "Test Form"}, "items": items}


# ---------------------------------------------------------------------------
# extract_form_id
# ---------------------------------------------------------------------------

def test_extract_form_id(svc: FormsService):
    url = "https://docs.google.com/forms/d/abc123XYZ/edit"
    assert svc.extract_form_id(url) == "abc123XYZ"


def test_extract_form_id_viewform_url(svc: FormsService):
    url = "https://docs.google.com/forms/d/e/abc123XYZ/viewform"
    assert svc.extract_form_id(url) == "e"


def test_extract_form_id_invalid(svc: FormsService):
    with pytest.raises(ValueError):
        svc.extract_form_id("https://example.com/not-a-form")


# ---------------------------------------------------------------------------
# get_form_questions — error handling
# ---------------------------------------------------------------------------

def test_get_form_questions_403(svc: FormsService):
    from googleapiclient.errors import HttpError
    resp = MagicMock()
    resp.status = 403
    svc._client.forms().get().execute.side_effect = HttpError(resp=resp, content=b"Forbidden")
    with pytest.raises(PermissionError, match="service account"):
        svc.get_form_questions("https://docs.google.com/forms/d/abc/edit")


def test_get_form_questions_404(svc: FormsService):
    from googleapiclient.errors import HttpError
    resp = MagicMock()
    resp.status = 404
    svc._client.forms().get().execute.side_effect = HttpError(resp=resp, content=b"Not Found")
    with pytest.raises(ValueError, match="not found"):
        svc.get_form_questions("https://docs.google.com/forms/d/abc/edit")


# ---------------------------------------------------------------------------
# get_form_questions — return shape is list[dict] with google_type + nexus_type
# ---------------------------------------------------------------------------

def test_returns_plain_dicts(svc: FormsService):
    """get_form_questions returns plain dicts, not Pydantic models."""
    svc._client.forms().get().execute.return_value = _make_form_response([
        {
            "itemId": "001",
            "title": "First Name",
            "questionItem": {
                "question": {"questionId": "q1", "textQuestion": {"paragraph": False}}
            },
        }
    ])
    questions = svc.get_form_questions("https://docs.google.com/forms/d/abc/edit")
    assert isinstance(questions, list)
    assert isinstance(questions[0], dict)
    assert "google_type" in questions[0]
    assert "nexus_type" in questions[0]


# ---------------------------------------------------------------------------
# get_form_questions — skips non-question items
# ---------------------------------------------------------------------------

def test_skips_section_headers(svc: FormsService):
    svc._client.forms().get().execute.return_value = _make_form_response([
        {"itemId": "001", "title": "Section 1"},  # no questionItem
        {
            "itemId": "002",
            "title": "Email",
            "questionItem": {
                "question": {"questionId": "q1", "textQuestion": {"paragraph": False}}
            },
        },
    ])
    questions = svc.get_form_questions("https://docs.google.com/forms/d/abc/edit")
    assert len(questions) == 1
    assert questions[0]["title"] == "Email"


# ---------------------------------------------------------------------------
# get_form_questions — text questions
# ---------------------------------------------------------------------------

def test_parses_short_text_question(svc: FormsService):
    svc._client.forms().get().execute.return_value = _make_form_response([
        {
            "itemId": "001",
            "title": "First Name",
            "questionItem": {
                "question": {"questionId": "q1", "textQuestion": {"paragraph": False}}
            },
        }
    ])
    questions = svc.get_form_questions("https://docs.google.com/forms/d/abc/edit")
    assert len(questions) == 1
    assert questions[0]["google_type"] == "TEXT"
    assert questions[0]["nexus_type"] == "string"
    assert questions[0]["options"] is None


def test_parses_paragraph_question(svc: FormsService):
    svc._client.forms().get().execute.return_value = _make_form_response([
        {
            "itemId": "001",
            "title": "Additional Notes",
            "questionItem": {
                "question": {"questionId": "q1", "textQuestion": {"paragraph": True}}
            },
        }
    ])
    questions = svc.get_form_questions("https://docs.google.com/forms/d/abc/edit")
    assert questions[0]["nexus_type"] == "string"


# ---------------------------------------------------------------------------
# get_form_questions — choice questions
# ---------------------------------------------------------------------------

def test_parses_checkbox_as_multi_select(svc: FormsService):
    svc._client.forms().get().execute.return_value = _make_form_response([
        {
            "itemId": "001",
            "title": "Which events?",
            "questionItem": {
                "question": {
                    "questionId": "q1",
                    "choiceQuestion": {
                        "type": "CHECKBOX",
                        "options": [
                            {"value": "Anatomy and Physiology - Study the human body"},
                            {"value": "Chemistry Lab - Hands-on lab skills"},
                        ],
                    },
                }
            },
        }
    ])
    questions = svc.get_form_questions("https://docs.google.com/forms/d/abc/edit")
    q = questions[0]
    assert q["google_type"] == "CHECKBOX"
    assert q["nexus_type"] == "multi_select"
    assert len(q["options"]) == 2
    # options are FormQuestionOption objects
    assert q["options"][0].raw == "Anatomy and Physiology - Study the human body"
    assert q["options"][0].alias == "Anatomy and Physiology"
    assert q["options"][1].raw == "Chemistry Lab - Hands-on lab skills"
    assert q["options"][1].alias == "Chemistry Lab"


def test_parses_radio_as_string(svc: FormsService):
    svc._client.forms().get().execute.return_value = _make_form_response([
        {
            "itemId": "001",
            "title": "T-shirt size",
            "questionItem": {
                "question": {
                    "questionId": "q1",
                    "choiceQuestion": {
                        "type": "MULTIPLE_CHOICE",
                        "options": [{"value": "S"}, {"value": "M"}, {"value": "L"}],
                    },
                }
            },
        }
    ])
    questions = svc.get_form_questions("https://docs.google.com/forms/d/abc/edit")
    assert questions[0]["google_type"] == "MULTIPLE_CHOICE"
    assert questions[0]["nexus_type"] == "string"
    assert len(questions[0]["options"]) == 3


def test_parses_dropdown_as_string(svc: FormsService):
    svc._client.forms().get().execute.return_value = _make_form_response([
        {
            "itemId": "001",
            "title": "Division",
            "questionItem": {
                "question": {
                    "questionId": "q1",
                    "choiceQuestion": {
                        "type": "DROP_DOWN",
                        "options": [{"value": "B"}, {"value": "C"}],
                    },
                }
            },
        }
    ])
    questions = svc.get_form_questions("https://docs.google.com/forms/d/abc/edit")
    assert questions[0]["google_type"] == "DROP_DOWN"
    assert questions[0]["nexus_type"] == "string"


# ---------------------------------------------------------------------------
# get_form_questions — scale questions
# ---------------------------------------------------------------------------

def test_parses_scale_as_integer(svc: FormsService):
    svc._client.forms().get().execute.return_value = _make_form_response([
        {
            "itemId": "001",
            "title": "Rate your experience",
            "questionItem": {
                "question": {
                    "questionId": "q1",
                    "scaleQuestion": {"low": 1, "high": 5},
                }
            },
        }
    ])
    questions = svc.get_form_questions("https://docs.google.com/forms/d/abc/edit")
    assert questions[0]["google_type"] == "LINEAR_SCALE"
    assert questions[0]["nexus_type"] == "integer"
    assert questions[0]["options"] is None


# ---------------------------------------------------------------------------
# get_form_questions — grid questions
# ---------------------------------------------------------------------------

def test_parses_grid_question(svc: FormsService):
    svc._client.forms().get().execute.return_value = _make_form_response([
        {
            "itemId": "001",
            "title": "Availability",
            "questionItem": {
                "question": {
                    "questionId": "q1",
                    "gridQuestion": {
                        "rows": [
                            {"value": "8:00 AM - 10:00 AM"},
                            {"value": "10:00 AM - 12:00 PM"},
                        ],
                        "columns": {
                            "type": "CHECKBOX",
                            "options": [{"value": "Available"}, {"value": "Maybe"}],
                        },
                    },
                }
            },
        }
    ])
    questions = svc.get_form_questions("https://docs.google.com/forms/d/abc/edit")
    q = questions[0]
    assert q["google_type"] == "GRID"
    assert q["nexus_type"] == "matrix_row"
    assert q["grid_rows"] == ["8:00 AM - 10:00 AM", "10:00 AM - 12:00 PM"]
    assert q["grid_columns"] == ["Available", "Maybe"]
    assert q["options"] is None


# ---------------------------------------------------------------------------
# _suggest_alias
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    # Dash separator
    ("Anatomy and Physiology - Study the human body", "Anatomy and Physiology"),
    ("Chemistry Lab - Hands-on laboratory skills",    "Chemistry Lab"),
    # Parenthetical suffix
    ("Chemistry Lab (hands-on lab work)",             "Chemistry Lab"),
    # Comma continuation
    ("Yes, I am available to volunteer",              "Yes"),
    # No pattern — returned as-is
    ("Codebusters",                                   "Codebusters"),
    ("Option A",                                      "Option A"),
    # Whitespace trimmed
    ("  Anatomy  - Something  ",                      "Anatomy"),
])
def test_suggest_alias(raw, expected):
    assert _suggest_alias(raw) == expected