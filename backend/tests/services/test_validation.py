"""Unit tests for validate_column_mappings."""
import pytest
from app.services.validation import validate_column_mappings


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
    return [e.header for e in result.errors]

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

def test_different_extra_keys_ok():
    result = validate_column_mappings(_base_mappings(**{
        "Transport": {"field": "extra_data", "type": "string", "extra_key": "transportation"},
        "Carpool":   {"field": "extra_data", "type": "integer", "extra_key": "carpool_seats"},
    }))
    assert result.ok


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
    assert any("parse_availability" in w.message for w in result.warnings)

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
    assert any("time range" in w.message for w in result.warnings)

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
# Per-rule — parse_availability on non-matrix_row
# ---------------------------------------------------------------------------

def test_parse_availability_on_non_matrix_row_is_error():
    result = validate_column_mappings(_base_mappings(**{
        "Notes": {
            "field": "notes", "type": "string",
            "rules": [{"condition": "always", "action": "parse_availability"}],
        },
    }))
    assert not result.ok
    assert any("parse_availability" in e.message for e in result.errors)
    assert _error_rule_indices(result)[0] == 0

def test_parse_availability_wrong_condition_is_error():
    result = validate_column_mappings(_base_mappings(**{
        "Availability [8:00 AM - 10:00 AM]": {
            "field": "availability", "type": "matrix_row",
            "row_key": "8:00 AM - 10:00 AM",
            "rules": [{"condition": "contains", "match": "Thu", "action": "parse_availability"}],
        },
    }))
    assert not result.ok
    assert any("always" in e.message for e in result.errors)


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