"""Unit tests for validate_column_mappings."""
import pytest
from app.services.sheets_validation import validate_column_mappings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _base_mappings(**overrides):
    """Minimal valid mappings — email mapped, no other required fields."""
    m = {
        "Email Address": {"field": "email", "type": "string"},
        "First Name":    {"field": "first_name", "type": "string"},
        "Last Name":     {"field": "last_name",  "type": "string"},
    }
    m.update(overrides)
    return m


def _errors(result):
    return [e.message for e in result.errors]

def _warnings(result):
    return [w.message for w in result.warnings]

def _error_headers(result):
    """Return headers as flat strings for easy assertion — normalise list to sorted str."""
    out = []
    for e in result.errors:
        if isinstance(e.header, list):
            out.append(sorted(e.header))
        else:
            out.append(e.header)
    return out

def _error_rule_indices(result):
    return [e.rule_index for e in result.errors]


# ---------------------------------------------------------------------------
# Config-level — email
# ---------------------------------------------------------------------------

def test_valid_mappings_no_errors():
    result = validate_column_mappings(_base_mappings())
    assert result.ok
    assert result.errors == []

def test_missing_email_is_error():
    result = validate_column_mappings({
        "First Name": {"field": "first_name", "type": "string"},
    })
    assert not result.ok
    assert any("email" in e.message.lower() for e in result.errors)

def test_missing_email_header_is_none():
    """Config-level errors that don't belong to a specific header use None."""
    result = validate_column_mappings({
        "First Name": {"field": "first_name", "type": "string"},
    })
    email_error = next(e for e in result.errors if "email" in e.message.lower() and "No column" in e.message)
    assert email_error.header is None

def test_email_wrong_type_is_error():
    result = validate_column_mappings(_base_mappings(**{
        "Email Address": {"field": "email", "type": "boolean"},
    }))
    assert not result.ok
    assert any("email" in e.message.lower() and "string" in e.message.lower()
               for e in result.errors)

def test_multiple_email_mappings_is_error():
    result = validate_column_mappings({
        "Email Address": {"field": "email", "type": "string"},
        "Email (2)":     {"field": "email", "type": "string"},
    })
    assert not result.ok
    assert any("multiple" in e.message.lower() for e in result.errors)

def test_ignored_email_column_not_counted():
    """An email column typed as ignore doesn't satisfy the email requirement."""
    result = validate_column_mappings({
        "Email Address": {"field": "__ignore__", "type": "ignore"},
    })
    assert not result.ok
    assert any("email" in e.message.lower() for e in result.errors)


# ---------------------------------------------------------------------------
# Config-level — duplicate extra_key
# ---------------------------------------------------------------------------

def test_duplicate_extra_key_is_error():
    result = validate_column_mappings(_base_mappings(**{
        "Transport Q1": {"field": "extra_data", "type": "string", "extra_key": "transportation"},
        "Transport Q2": {"field": "extra_data", "type": "string", "extra_key": "transportation"},
    }))
    assert not result.ok
    assert any("transportation" in e.message for e in result.errors)

def test_duplicate_extra_key_header_is_list():
    """Duplicate extra_key errors must carry header as list[str], not a joined string."""
    result = validate_column_mappings(_base_mappings(**{
        "Transport Q1": {"field": "extra_data", "type": "string", "extra_key": "transportation"},
        "Transport Q2": {"field": "extra_data", "type": "string", "extra_key": "transportation"},
    }))
    dup_error = next(e for e in result.errors if "transportation" in e.message)
    assert isinstance(dup_error.header, list), (
        "Duplicate extra_key header must be list[str] so frontend can highlight both rows "
        "without splitting on commas (which would break headers that contain commas)."
    )
    assert set(dup_error.header) == {"Transport Q1", "Transport Q2"}

def test_duplicate_extra_key_header_list_serialised_in_response():
    """to_response_dict must serialise list headers as lists (not joined strings)."""
    result = validate_column_mappings(_base_mappings(**{
        "Transport Q1": {"field": "extra_data", "type": "string", "extra_key": "transportation"},
        "Transport Q2": {"field": "extra_data", "type": "string", "extra_key": "transportation"},
    }))
    response = result.to_response_dict()
    dup_error = next(e for e in response["errors"] if "transportation" in e["message"])
    assert isinstance(dup_error["header"], list)
    assert set(dup_error["header"]) == {"Transport Q1", "Transport Q2"}

def test_duplicate_extra_key_header_with_commas_in_name():
    """Headers containing commas must not be confused with joined strings."""
    h1 = "Have you competed in Science Olympiad in the past?"
    h2 = "If you have competed, please list events"  # contains a comma
    result = validate_column_mappings(_base_mappings(**{
        h1: {"field": "extra_data", "type": "string", "extra_key": "scioly_competed"},
        h2: {"field": "extra_data", "type": "string", "extra_key": "scioly_competed"},
    }))
    dup_error = next(e for e in result.errors if "scioly_competed" in e.message)
    assert isinstance(dup_error.header, list)
    assert h1 in dup_error.header
    assert h2 in dup_error.header

def test_different_extra_keys_ok():
    result = validate_column_mappings(_base_mappings(**{
        "Transport": {"field": "extra_data", "type": "string", "extra_key": "transportation"},
        "Carpool":   {"field": "extra_data", "type": "integer", "extra_key": "carpool_seats"},
    }))
    assert result.ok

def test_matrix_row_with_same_extra_key_not_duplicate_error():
    """matrix_row columns sharing an extra_key do not overwrite — no duplicate extra_key error."""
    result = validate_column_mappings(_base_mappings(**{
        "Which protein?": {"field": "lunch_order", "type": "matrix_row", "row_key": "protein"},
        "Drink choice":   {"field": "lunch_order", "type": "matrix_row", "row_key": "drink"},
    }))
    assert not any("Duplicate extra_key" in e.message for e in result.errors)

def test_duplicate_row_key_same_field_is_error():
    """Two matrix_row columns with the same field and row_key DO overwrite — error."""
    result = validate_column_mappings(_base_mappings(**{
        "Lunch col 1": {"field": "lunch_order", "type": "matrix_row", "row_key": "protein"},
        "Lunch col 2": {"field": "lunch_order", "type": "matrix_row", "row_key": "protein"},
    }))
    assert not result.ok
    assert any("Duplicate row_key" in e.message and "protein" in e.message for e in result.errors)

def test_duplicate_row_key_different_fields_ok():
    """Same row_key across different fields is fine — they write to separate buckets."""
    result = validate_column_mappings(_base_mappings(**{
        "Avail morning":    {"field": "availability",  "type": "matrix_row", "row_key": "morning",
                             "rules": [{"condition": "always", "action": "parse_time_range"}]},
        "Pref morning":     {"field": "event_preference", "type": "matrix_row", "row_key": "morning"},
    }))
    assert not any("Duplicate row_key" in e.message for e in result.errors)


# ---------------------------------------------------------------------------
# Per-mapping — matrix_row
# ---------------------------------------------------------------------------

def test_matrix_row_missing_row_key_is_error():
    result = validate_column_mappings(_base_mappings(**{
        "Availability [8AM]": {"field": "availability", "type": "matrix_row"},
    }))
    assert not result.ok
    assert any("row_key" in e.message for e in result.errors)

def test_matrix_row_with_row_key_ok():
    result = validate_column_mappings(_base_mappings(**{
        "Availability [8:00 AM - 10:00 AM]": {
            "field": "availability", "type": "matrix_row",
            "row_key": "8:00 AM - 10:00 AM",
            "rules": [{"condition": "always", "action": "parse_availability"}],
        },
    }))
    assert result.ok


# ---------------------------------------------------------------------------
# Per-mapping — extra_data missing extra_key
# ---------------------------------------------------------------------------

def test_extra_data_missing_extra_key_is_error():
    result = validate_column_mappings(_base_mappings(**{
        "Transport": {"field": "extra_data", "type": "string"},
    }))
    assert not result.ok
    assert any("extra_key" in e.message for e in result.errors)


# ---------------------------------------------------------------------------
# Per-mapping — delimiter on non-multi_select
# ---------------------------------------------------------------------------

def test_delimiter_on_non_multi_select_is_error():
    result = validate_column_mappings(_base_mappings(**{
        "Notes": {"field": "notes", "type": "string", "delimiter": ";"},
    }))
    assert not result.ok
    assert any("delimiter" in e.message for e in result.errors)

def test_delimiter_on_multi_select_ok():
    result = validate_column_mappings(_base_mappings(**{
        "Role": {"field": "role_preference", "type": "multi_select", "delimiter": ";"},
    }))
    assert result.ok


# ---------------------------------------------------------------------------
# Per-mapping — availability without parse_availability rule (warning)
# ---------------------------------------------------------------------------

def test_availability_matrix_row_no_rule_is_warning():
    result = validate_column_mappings(_base_mappings(**{
        "Availability [8:00 AM - 10:00 AM]": {
            "field": "availability", "type": "matrix_row",
            "row_key": "8:00 AM - 10:00 AM",
        },
    }))
    assert result.ok  # warning only, not an error
    assert any("parse_time_range" in w.message for w in result.warnings)

def test_availability_matrix_row_with_rule_no_warning():
    result = validate_column_mappings(_base_mappings(**{
        "Availability [8:00 AM - 10:00 AM]": {
            "field": "availability", "type": "matrix_row",
            "row_key": "8:00 AM - 10:00 AM",
            "rules": [{"condition": "always", "action": "parse_availability"}],
        },
    }))
    assert result.ok
    assert not any("parse_availability" in w.message for w in result.warnings)


# ---------------------------------------------------------------------------
# Per-mapping — row_key time range format (warning)
# ---------------------------------------------------------------------------

def test_unparseable_row_key_is_warning():
    result = validate_column_mappings(_base_mappings(**{
        "Availability [morning]": {
            "field": "notes", "type": "matrix_row",
            "row_key": "morning",
        },
    }))
    assert result.ok
    assert not any("time range" in w.message for w in result.warnings)

def test_valid_row_key_no_warning():
    result = validate_column_mappings(_base_mappings(**{
        "Availability [8:00 AM - 10:00 AM]": {
            "field": "availability", "type": "matrix_row",
            "row_key": "8:00 AM - 10:00 AM",
            "rules": [{"condition": "always", "action": "parse_availability"}],
        },
    }))
    assert not any("time range" in w.message for w in result.warnings)


# ---------------------------------------------------------------------------
# Per-rule — parse_availability / parse_time_range
# ---------------------------------------------------------------------------

def test_parse_availability_on_non_matrix_row_is_ok():
    result = validate_column_mappings(_base_mappings(**{
        "Notes": {
            "field": "notes", "type": "string",
            "rules": [{"condition": "always", "action": "parse_availability"}],
        },
    }))
    assert result.ok
    assert result.errors == []

def test_parse_availability_non_always_condition_is_ok():
    result = validate_column_mappings(_base_mappings(**{
        "Availability [8:00 AM - 10:00 AM]": {
            "field": "availability", "type": "matrix_row",
            "row_key": "8:00 AM - 10:00 AM",
            "rules": [{"condition": "contains", "match": "Thu", "action": "parse_availability"}],
        },
    }))
    assert result.ok
    assert not any("always" in e.message for e in result.errors)


# ---------------------------------------------------------------------------
# Per-rule — invalid regex
# ---------------------------------------------------------------------------

def test_invalid_regex_is_error():
    result = validate_column_mappings(_base_mappings(**{
        "Role": {
            "field": "role_preference", "type": "string",
            "rules": [{"condition": "regex", "match": "[invalid(", "action": "set", "value": "x"}],
        },
    }))
    assert not result.ok
    assert any("regex" in e.message.lower() for e in result.errors)

def test_valid_regex_ok():
    result = validate_column_mappings(_base_mappings(**{
        "Role": {
            "field": "role_preference", "type": "string",
            "rules": [{"condition": "regex", "match": r"\bGV\b", "action": "set", "value": "GV"}],
        },
    }))
    assert result.ok


# ---------------------------------------------------------------------------
# Per-rule — match required for non-always conditions
# ---------------------------------------------------------------------------

def test_missing_match_on_contains_is_error():
    result = validate_column_mappings(_base_mappings(**{
        "Role": {
            "field": "role_preference", "type": "string",
            "rules": [{"condition": "contains", "action": "set", "value": "GV"}],
        },
    }))
    assert not result.ok
    assert any("match" in e.message for e in result.errors)

def test_always_condition_no_match_ok():
    result = validate_column_mappings(_base_mappings(**{
        "Role": {
            "field": "role_preference", "type": "string",
            "rules": [{"condition": "always", "action": "append", "value": "!"}],
        },
    }))
    assert result.ok


# ---------------------------------------------------------------------------
# Per-rule — value required for output actions
# ---------------------------------------------------------------------------

def test_missing_value_on_set_is_error():
    result = validate_column_mappings(_base_mappings(**{
        "Role": {
            "field": "role_preference", "type": "string",
            "rules": [{"condition": "always", "action": "set"}],
        },
    }))
    assert not result.ok
    assert any("value" in e.message for e in result.errors)

def test_discard_no_value_ok():
    result = validate_column_mappings(_base_mappings(**{
        "Role": {
            "field": "role_preference", "type": "string",
            "rules": [{"condition": "contains", "match": "n/a", "action": "discard"}],
        },
    }))
    assert result.ok


# ---------------------------------------------------------------------------
# Per-rule — set followed by more rules (warning)
# ---------------------------------------------------------------------------

def test_rule_after_set_is_warning():
    result = validate_column_mappings(_base_mappings(**{
        "Role": {
            "field": "role_preference", "type": "string",
            "rules": [
                {"condition": "always",   "action": "set",    "value": "GV"},
                {"condition": "contains", "match": "GV", "action": "append", "value": "!"},
            ],
        },
    }))
    assert result.ok  # warning only
    assert any("set" in w.message for w in result.warnings)
    assert result.warnings[0].rule_index == 1

def test_set_as_last_rule_no_warning():
    result = validate_column_mappings(_base_mappings(**{
        "Role": {
            "field": "role_preference", "type": "string",
            "rules": [
                {"condition": "contains", "match": "GV", "action": "append", "value": "!"},
                {"condition": "always",   "action": "set",    "value": "GV"},
            ],
        },
    }))
    assert result.ok
    assert not any("set" in w.message for w in result.warnings)


# ---------------------------------------------------------------------------
# to_response_dict — header serialization
# ---------------------------------------------------------------------------

def test_single_header_serialised_as_list():
    """Single-header issues must also come out as list[str] in the response."""
    result = validate_column_mappings(_base_mappings(**{
        "Transport": {"field": "extra_data", "type": "string"},
    }))
    response = result.to_response_dict()
    extra_key_error = next(e for e in response["errors"] if "extra_key" in e["message"])
    assert isinstance(extra_key_error["header"], list)
    assert extra_key_error["header"] == ["Transport"]

def test_none_header_serialised_as_none():
    """Config-level errors with no header must serialise as null."""
    result = validate_column_mappings({
        "First Name": {"field": "first_name", "type": "string"},
    })
    response = result.to_response_dict()
    email_error = next(e for e in response["errors"] if "No column" in e["message"])
    assert email_error["header"] is None


# ---------------------------------------------------------------------------
# Multiple errors in one call
# ---------------------------------------------------------------------------

def test_multiple_errors_all_returned():
    result = validate_column_mappings({
        # no email
        "First Name": {"field": "first_name", "type": "string"},
        # matrix_row missing row_key
        "Avail": {"field": "availability", "type": "matrix_row"},
        # extra_data missing extra_key
        "Transport": {"field": "extra_data", "type": "string"},
    })
    assert not result.ok
    assert len(result.errors) >= 3
