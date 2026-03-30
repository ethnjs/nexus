"""Unit tests for sync_service helpers — no DB, no Google API."""
import pytest
from datetime import datetime
from app.services.sync_service import (
    _parse_time,
    _parse_time_range,
    _parse_day_string,
    _parse_availability,
    _merge_availability,
    _rule_matches,
    _apply_rules,
    _process_cell,
)
from app.schemas.sheet_config import coerce_legacy_type
from unittest.mock import MagicMock


def _make_tournament(blocks=None, start_date=None):
    t = MagicMock()
    t.blocks = blocks or []
    t.start_date = start_date
    return t


NATS_BLOCKS = [
    {"number": 1,  "label": "Thu Check-in", "date": "2026-05-21", "start": "08:00", "end": "10:00"},
    {"number": 2,  "label": "Thu Morning",  "date": "2026-05-21", "start": "10:00", "end": "12:00"},
    {"number": 3,  "label": "Fri Check-in", "date": "2026-05-22", "start": "08:00", "end": "10:00"},
    {"number": 14, "label": "Sat Block 1",  "date": "2026-05-23", "start": "08:00", "end": "09:00"},
    {"number": 15, "label": "Sat Block 2",  "date": "2026-05-23", "start": "09:15", "end": "10:15"},
]


# ---------------------------------------------------------------------------
# _parse_time
# ---------------------------------------------------------------------------

def test_parse_time_am():
    assert _parse_time("8:00 AM") == "08:00"

def test_parse_time_pm():
    assert _parse_time("2:00 PM") == "14:00"

def test_parse_time_noon():
    assert _parse_time("NOON") == "12:00"

def test_parse_time_noon_as_12pm():
    assert _parse_time("12:00 PM") == "12:00"

def test_parse_time_midnight():
    assert _parse_time("MIDNIGHT") == "00:00"

def test_parse_time_12am():
    assert _parse_time("12:00 AM") == "00:00"

def test_parse_time_invalid():
    with pytest.raises(ValueError):
        _parse_time("not a time")


# ---------------------------------------------------------------------------
# _parse_time_range
# ---------------------------------------------------------------------------

def test_parse_time_range():
    assert _parse_time_range("8:00 AM - 10:00 AM") == ("08:00", "10:00")

def test_parse_time_range_noon():
    assert _parse_time_range("10:00 AM - NOON") == ("10:00", "12:00")

def test_parse_time_range_pm():
    assert _parse_time_range("NOON - 2:00 PM") == ("12:00", "14:00")

def test_parse_time_range_extra_spaces():
    """Real Google Forms headers often have extra spaces around the dash."""
    assert _parse_time_range("8:00 AM  - 10:00 AM") == ("08:00", "10:00")
    assert _parse_time_range("10:00 AM  -  NOON") == ("10:00", "12:00")


# ---------------------------------------------------------------------------
# _parse_day_string
# ---------------------------------------------------------------------------

def test_parse_day_string_thursday():
    t = _make_tournament(NATS_BLOCKS)
    assert _parse_day_string("Thursday 5/21", t) == "2026-05-21"

def test_parse_day_string_saturday():
    t = _make_tournament(NATS_BLOCKS)
    assert _parse_day_string("Saturday 5/23", t) == "2026-05-23"

def test_parse_day_string_no_match_fallback():
    t = _make_tournament([], start_date=datetime(2026, 5, 21))
    assert _parse_day_string("Sunday 5/24", t) == "2026-05-24"

def test_parse_day_string_no_date_pattern():
    t = _make_tournament(NATS_BLOCKS)
    assert _parse_day_string("Thursday", t) is None

def test_parse_day_string_month_name():
    t = _make_tournament([], start_date=datetime(2026, 5, 21))
    assert _parse_day_string("February 14", t) == "2026-02-14"


# ---------------------------------------------------------------------------
# _parse_availability
# ---------------------------------------------------------------------------

def test_parse_availability_none():
    t = _make_tournament(NATS_BLOCKS)
    assert _parse_availability("None", "8:00 AM - 10:00 AM", t) == []

def test_parse_availability_empty():
    t = _make_tournament(NATS_BLOCKS)
    assert _parse_availability("", "8:00 AM - 10:00 AM", t) == []

def test_parse_availability_single_day():
    t = _make_tournament(NATS_BLOCKS)
    slots = _parse_availability("Thursday 5/21", "8:00 AM - 10:00 AM", t)
    assert len(slots) == 1
    assert slots[0] == {"date": "2026-05-21", "start": "08:00", "end": "10:00"}

def test_parse_availability_multiple_days():
    t = _make_tournament(NATS_BLOCKS)
    slots = _parse_availability(
        "Thursday 5/21, Saturday 5/23", "8:00 AM - 10:00 AM", t
    )
    assert len(slots) == 2
    assert slots[0]["date"] == "2026-05-21"
    assert slots[1]["date"] == "2026-05-23"


# ---------------------------------------------------------------------------
# _merge_availability
# ---------------------------------------------------------------------------

def test_merge_availability_contiguous():
    """8-10 and 10-noon on same day merge into 8-noon."""
    slots = [
        {"date": "2026-05-21", "start": "08:00", "end": "10:00"},
        {"date": "2026-05-21", "start": "10:00", "end": "12:00"},
    ]
    merged = _merge_availability([], slots)
    assert len(merged) == 1
    assert merged[0] == {"date": "2026-05-21", "start": "08:00", "end": "12:00"}

def test_merge_availability_gap():
    """8-10 and noon-2pm on same day stay separate (gap)."""
    slots = [
        {"date": "2026-05-21", "start": "08:00", "end": "10:00"},
        {"date": "2026-05-21", "start": "12:00", "end": "14:00"},
    ]
    merged = _merge_availability([], slots)
    assert len(merged) == 2

def test_merge_availability_different_dates():
    """Slots on different dates never merge."""
    slots = [
        {"date": "2026-05-21", "start": "08:00", "end": "10:00"},
        {"date": "2026-05-23", "start": "08:00", "end": "10:00"},
    ]
    merged = _merge_availability([], slots)
    assert len(merged) == 2

def test_merge_availability_three_contiguous():
    """Three consecutive slots merge into one."""
    slots = [
        {"date": "2026-05-23", "start": "08:00", "end": "10:00"},
        {"date": "2026-05-23", "start": "10:00", "end": "12:00"},
        {"date": "2026-05-23", "start": "12:00", "end": "14:00"},
    ]
    merged = _merge_availability([], slots)
    assert len(merged) == 1
    assert merged[0]["start"] == "08:00"
    assert merged[0]["end"] == "14:00"

def test_merge_availability_with_existing():
    """New slots merge with pre-existing slots."""
    existing = [{"date": "2026-05-21", "start": "08:00", "end": "10:00"}]
    new = [{"date": "2026-05-21", "start": "10:00", "end": "12:00"}]
    merged = _merge_availability(existing, new)
    assert len(merged) == 1
    assert merged[0]["end"] == "12:00"


# ---------------------------------------------------------------------------
# coerce_legacy_type
# ---------------------------------------------------------------------------

def test_coerce_legacy_availability_row():
    assert coerce_legacy_type("availability_row") == "matrix_row"

def test_coerce_legacy_category_events():
    assert coerce_legacy_type("category_events") == "string"

def test_coerce_current_type_unchanged():
    for t in ("string", "ignore", "boolean", "integer", "multi_select", "matrix_row"):
        assert coerce_legacy_type(t) == t


# ---------------------------------------------------------------------------
# _process_cell — legacy type coercion
# ---------------------------------------------------------------------------

def test_process_cell_legacy_availability_row_coerced(caplog):
    """availability_row is coerced to matrix_row. Without a parse_availability
    rule, matrix_row returns the raw string — the TD must add the rule."""
    import logging
    t = _make_tournament(NATS_BLOCKS)
    mapping = {
        "field": "availability",
        "type": "availability_row",
        "row_key": "8:00 AM - 10:00 AM",
    }
    with caplog.at_level(logging.WARNING):
        result = _process_cell("Thursday 5/21", mapping, t)
    assert result == "Thursday 5/21"
    assert "availability_row" in caplog.text


def test_process_cell_legacy_category_events_coerced(caplog):
    """category_events is coerced to string and returns raw value."""
    import logging
    t = _make_tournament(NATS_BLOCKS)
    mapping = {"field": "event_preference", "type": "category_events"}
    with caplog.at_level(logging.WARNING):
        result = _process_cell("Technology & Engineering (Boomilever)", mapping, t)
    assert result == "Technology & Engineering (Boomilever)"
    assert "category_events" in caplog.text


# ---------------------------------------------------------------------------
# _rule_matches
# ---------------------------------------------------------------------------

def test_rule_matches_always():
    assert _rule_matches("anything", "always", None, False) is True

def test_rule_matches_contains_case_insensitive():
    assert _rule_matches("General Volunteer", "contains", "general volunteer", False) is True

def test_rule_matches_contains_case_sensitive_miss():
    assert _rule_matches("General Volunteer", "contains", "general volunteer", True) is False

def test_rule_matches_contains_case_sensitive_hit():
    assert _rule_matches("general volunteer", "contains", "general volunteer", True) is True

def test_rule_matches_equals():
    assert _rule_matches("GV", "equals", "gv", False) is True
    assert _rule_matches("GV", "equals", "gv", True) is False

def test_rule_matches_starts_with():
    assert _rule_matches("Event Supervisor", "starts_with", "event", False) is True
    assert _rule_matches("Event Supervisor", "starts_with", "supervisor", False) is False

def test_rule_matches_ends_with():
    assert _rule_matches("Event Supervisor", "ends_with", "supervisor", False) is True
    assert _rule_matches("Event Supervisor", "ends_with", "event", False) is False

def test_rule_matches_regex():
    assert _rule_matches("Boomilever", "regex", r"boom\w+", False) is True
    assert _rule_matches("Helicopter", "regex", r"boom\w+", False) is False

def test_rule_matches_regex_case_insensitive():
    assert _rule_matches("BOOMILEVER", "regex", r"boom\w+", False) is True

def test_rule_matches_no_match_string_returns_false():
    assert _rule_matches("hello", "contains", None, False) is False


# ---------------------------------------------------------------------------
# _apply_rules
# ---------------------------------------------------------------------------

def _t():
    return _make_tournament(NATS_BLOCKS)


def test_apply_rules_set():
    rules = [{"condition": "contains", "match": "general volunteer", "action": "set", "value": "GV"}]
    result = _apply_rules("I am a General Volunteer", rules, {}, _t())
    assert result == "GV"

def test_apply_rules_set_no_match_unchanged():
    rules = [{"condition": "contains", "match": "general volunteer", "action": "set", "value": "GV"}]
    result = _apply_rules("Event Supervisor", rules, {}, _t())
    assert result == "Event Supervisor"

def test_apply_rules_replace_literal():
    rules = [{"condition": "contains", "match": "General Volunteer", "action": "replace", "value": "GV", "case_sensitive": False}]
    result = _apply_rules("I am a General Volunteer and Event Supervisor", rules, {}, _t())
    assert result == "I am a GV and Event Supervisor"

def test_apply_rules_replace_regex():
    rules = [{"condition": "regex", "match": r"\s*\([^)]*\)", "action": "replace", "value": ""}]
    result = _apply_rules("Life, Personal & Social Science (Anatomy, Designer Genes)", rules, {}, _t())
    assert result == "Life, Personal & Social Science"

def test_apply_rules_prepend():
    rules = [{"condition": "always", "action": "prepend", "value": "PREFIX-"}]
    assert _apply_rules("hello", rules, {}, _t()) == "PREFIX-hello"

def test_apply_rules_append():
    rules = [{"condition": "always", "action": "append", "value": "-SUFFIX"}]
    assert _apply_rules("hello", rules, {}, _t()) == "hello-SUFFIX"

def test_apply_rules_discard():
    rules = [{"condition": "contains", "match": "n/a", "action": "discard"}]
    assert _apply_rules("N/A", rules, {}, _t()) is None

def test_apply_rules_discard_no_match_unchanged():
    rules = [{"condition": "contains", "match": "n/a", "action": "discard"}]
    assert _apply_rules("yes", rules, {}, _t()) == "yes"

def test_apply_rules_sequential_all_fire():
    """Both rules fire in order — second sees output of first."""
    rules = [
        {"condition": "contains", "match": "General Volunteer", "action": "replace", "value": "GV"},
        {"condition": "contains", "match": "Event Supervisor",  "action": "replace", "value": "ES"},
    ]
    result = _apply_rules("General Volunteer, Event Supervisor", rules, {}, _t())
    assert result == "GV, ES"

def test_apply_rules_parse_availability_short_circuits():
    """parse_availability returns a list and stops rule processing."""
    mapping = {"row_key": "8:00 AM - 10:00 AM"}
    rules = [
        {"condition": "always", "action": "parse_availability"},
        # this rule would fire on a string but should never run
        {"condition": "always", "action": "set", "value": "SHOULD NOT APPEAR"},
    ]
    result = _apply_rules("Thursday 5/21", rules, mapping, _make_tournament(NATS_BLOCKS))
    assert isinstance(result, list)
    assert result == [{"date": "2026-05-21", "start": "08:00", "end": "10:00"}]

def test_apply_rules_parse_availability_without_row_key_extracts_from_value():
    rules = [{"condition": "always", "action": "parse_time_range"}]
    result = _apply_rules(
        "February 14 7:00AM - 5:00PM",
        rules,
        {},
        _make_tournament(start_date=datetime(2026, 5, 21)),
    )
    assert result == [{"date": "2026-02-14", "start": "07:00", "end": "17:00"}]

def test_apply_rules_empty_rules_unchanged():
    assert _apply_rules("hello", [], {}, _t()) == "hello"


# ---------------------------------------------------------------------------
# _process_cell — rules integration
# ---------------------------------------------------------------------------

def test_process_cell_rules_run_before_type_coercion():
    """Rule normalizes value, then boolean coercion fires on the result."""
    t = _make_tournament(NATS_BLOCKS)
    mapping = {
        "field": "extra_data",
        "type": "boolean",
        "extra_key": "competed",
        "rules": [{"condition": "contains", "match": "yes i have", "action": "set", "value": "yes"}],
    }
    assert _process_cell("Yes I have", mapping, t) is True

def test_process_cell_rules_discard_returns_none():
    t = _make_tournament(NATS_BLOCKS)
    mapping = {
        "field": "notes",
        "type": "string",
        "rules": [{"condition": "equals", "match": "n/a", "action": "discard"}],
    }
    assert _process_cell("N/A", mapping, t) is None

def test_process_cell_multi_select_custom_delimiter():
    t = _make_tournament(NATS_BLOCKS)
    mapping = {"field": "role_preference", "type": "multi_select", "delimiter": ";"}
    result = _process_cell("Event Supervisor;General Volunteer;Floater", mapping, t)
    assert result == ["Event Supervisor", "General Volunteer", "Floater"]

def test_process_cell_parse_availability_via_rule():
    """matrix_row + parse_availability rule produces slots list."""
    t = _make_tournament(NATS_BLOCKS)
    mapping = {
        "field": "availability",
        "type": "matrix_row",
        "row_key": "8:00 AM - 10:00 AM",
        "rules": [{"condition": "always", "action": "parse_availability"}],
    }
    result = _process_cell("Thursday 5/21", mapping, t)
    assert result == [{"date": "2026-05-21", "start": "08:00", "end": "10:00"}]

def test_process_cell_matrix_row_no_rule_returns_string():
    """matrix_row without a parse_availability rule stores raw string."""
    t = _make_tournament(NATS_BLOCKS)
    mapping = {"field": "availability", "type": "matrix_row", "row_key": "8:00 AM - 10:00 AM"}
    result = _process_cell("Thursday 5/21", mapping, t)
    assert result == "Thursday 5/21"

def test_process_cell_string_parse_time_range_rule():
    t = _make_tournament(start_date=datetime(2026, 5, 21))
    mapping = {
        "field": "availability",
        "type": "string",
        "rules": [{"condition": "always", "action": "parse_time_range"}],
    }
    result = _process_cell("February 14 7:00AM - 5:00PM", mapping, t)
    assert result == [{"date": "2026-02-14", "start": "07:00", "end": "17:00"}]


def test_process_cell_phone_formats_us_number():
    t = _make_tournament(NATS_BLOCKS)
    mapping = {"field": "phone", "type": "string"}
    assert _process_cell("9495551234", mapping, t) == "(949) 555-1234"
    assert _process_cell("+1 (949) 555-1234", mapping, t) == "(949) 555-1234"
