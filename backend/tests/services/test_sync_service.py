"""Unit tests for sync_service helpers — no DB, no Google API."""
import pytest
from app.services.sync_service import (
    _parse_time,
    _parse_time_range,
    _parse_day_string,
    _parse_availability,
    _merge_availability,
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
    from datetime import datetime
    t = _make_tournament([], start_date=datetime(2026, 5, 21))
    assert _parse_day_string("Sunday 5/24", t) == "2026-05-24"

def test_parse_day_string_no_date_pattern():
    t = _make_tournament(NATS_BLOCKS)
    assert _parse_day_string("Thursday", t) is None


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
    """availability_row is coerced to matrix_row and processes as availability."""
    import logging
    t = _make_tournament(NATS_BLOCKS)
    mapping = {
        "field": "availability",
        "type": "availability_row",
        "row_key": "8:00 AM - 10:00 AM",
    }
    with caplog.at_level(logging.WARNING):
        result = _process_cell("Thursday 5/21", mapping, t)
    assert result == [{"date": "2026-05-21", "start": "08:00", "end": "10:00"}]
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