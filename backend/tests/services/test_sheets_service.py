"""Unit tests for SheetsService — all Google API calls are mocked."""

import pytest
from unittest.mock import MagicMock, patch
from app.services.sheets_service import SheetsService
from app.schemas.sheet_config import ColumnMapping


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
# _detect_field — rich ColumnMapping output
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
    ("Which event would you like?",  "event_preference","category_events", None),
    ("General Volunteer Interest",   "general_volunteer_interest", "multi_select", None),
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