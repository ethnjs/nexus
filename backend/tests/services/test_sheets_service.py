"""
Unit tests for SheetsService.

All Google API calls are mocked — no network required.
"""

import pytest
from unittest.mock import MagicMock, patch
from googleapiclient.errors import HttpError

from app.services.sheets_service import SheetsService


# ---------------------------------------------------------------------------
# Fixture: SheetsService with mocked Google client
# ---------------------------------------------------------------------------

@pytest.fixture
def svc():
    """SheetsService with the Google API client replaced by a MagicMock."""
    with patch("app.services.sheets_service.service_account") as mock_sa, \
         patch("app.services.sheets_service.build") as mock_build:
        mock_sa.Credentials.from_service_account_file.return_value = MagicMock()
        mock_build.return_value = MagicMock()
        service = SheetsService()
        # Expose the mock client for test-level configuration
        service._mock_client = mock_build.return_value
        yield service


# ---------------------------------------------------------------------------
# extract_spreadsheet_id
# ---------------------------------------------------------------------------

class TestExtractSpreadsheetId:
    def test_standard_edit_url(self, svc):
        url = "https://docs.google.com/spreadsheets/d/abc123XYZ/edit#gid=0"
        assert svc.extract_spreadsheet_id(url) == "abc123XYZ"

    def test_url_without_edit(self, svc):
        url = "https://docs.google.com/spreadsheets/d/mySheetId_456/"
        assert svc.extract_spreadsheet_id(url) == "mySheetId_456"

    def test_invalid_url_raises(self, svc):
        with pytest.raises(ValueError, match="Could not extract"):
            svc.extract_spreadsheet_id("https://example.com/not-a-sheet")


# ---------------------------------------------------------------------------
# validate_sheet_url
# ---------------------------------------------------------------------------

class TestValidateSheetUrl:
    def _setup_mock(self, svc, title: str, sheet_names: list[str]):
        mock_sheets = svc._mock_client.spreadsheets.return_value
        mock_sheets.get.return_value.execute.return_value = {
            "properties": {"title": title},
            "sheets": [{"properties": {"title": n}} for n in sheet_names],
        }

    def test_returns_title_and_tabs(self, svc):
        self._setup_mock(svc, "Volunteer Interest Form", ["Form Responses 1", "Sheet2"])
        url = "https://docs.google.com/spreadsheets/d/abc123/edit"
        result = svc.validate_sheet_url(url)
        assert result.spreadsheet_title == "Volunteer Interest Form"
        assert result.sheet_names == ["Form Responses 1", "Sheet2"]
        assert result.spreadsheet_id == "abc123"

    def test_permission_error_on_403(self, svc):
        mock_sheets = svc._mock_client.spreadsheets.return_value
        mock_resp = MagicMock()
        mock_resp.status = 403
        mock_sheets.get.return_value.execute.side_effect = HttpError(mock_resp, b"Forbidden")
        with pytest.raises(PermissionError):
            svc.validate_sheet_url("https://docs.google.com/spreadsheets/d/abc/edit")

    def test_value_error_on_404(self, svc):
        mock_sheets = svc._mock_client.spreadsheets.return_value
        mock_resp = MagicMock()
        mock_resp.status = 404
        mock_sheets.get.return_value.execute.side_effect = HttpError(mock_resp, b"Not Found")
        with pytest.raises(ValueError, match="not found"):
            svc.validate_sheet_url("https://docs.google.com/spreadsheets/d/abc/edit")


# ---------------------------------------------------------------------------
# get_headers + auto-detection
# ---------------------------------------------------------------------------

class TestGetHeaders:
    def _setup_mock(self, svc, headers: list[str]):
        mock_values = svc._mock_client.spreadsheets.return_value.values.return_value
        mock_values.get.return_value.execute.return_value = {"values": [headers]}

    def test_returns_headers_and_suggestions(self, svc):
        self._setup_mock(svc, ["Timestamp", "Email Address", "First Name", "T-Shirt Size"])
        result = svc.get_headers(
            "https://docs.google.com/spreadsheets/d/abc/edit", "Form Responses 1"
        )
        assert result.headers == ["Timestamp", "Email Address", "First Name", "T-Shirt Size"]
        assert result.suggestions["Timestamp"] == "__ignore__"
        assert result.suggestions["Email Address"] == "email"
        assert result.suggestions["First Name"] == "first_name"
        assert result.suggestions["T-Shirt Size"] == "shirt_size"

    def test_empty_sheet_returns_empty(self, svc):
        mock_values = svc._mock_client.spreadsheets.return_value.values.return_value
        mock_values.get.return_value.execute.return_value = {"values": []}
        result = svc.get_headers(
            "https://docs.google.com/spreadsheets/d/abc/edit", "Empty Sheet"
        )
        assert result.headers == []
        assert result.suggestions == {}

    def test_unknown_header_maps_to_ignore(self, svc):
        self._setup_mock(svc, ["Some Weird Question Nobody Knows"])
        result = svc.get_headers(
            "https://docs.google.com/spreadsheets/d/abc/edit", "Sheet1"
        )
        assert result.suggestions["Some Weird Question Nobody Knows"] == "__ignore__"


# ---------------------------------------------------------------------------
# get_rows
# ---------------------------------------------------------------------------

class TestGetRows:
    def _setup_mock(self, svc, rows: list[list[str]]):
        mock_values = svc._mock_client.spreadsheets.return_value.values.return_value
        mock_values.get.return_value.execute.return_value = {"values": rows}

    def test_returns_dicts_keyed_by_header(self, svc):
        self._setup_mock(svc, [
            ["First Name", "Last Name", "Email"],
            ["Alice", "Smith", "alice@example.com"],
            ["Bob", "Jones", "bob@example.com"],
        ])
        rows = svc.get_rows("fake_id", "Sheet1")
        assert len(rows) == 2
        assert rows[0] == {"First Name": "Alice", "Last Name": "Smith", "Email": "alice@example.com"}

    def test_pads_short_rows(self, svc):
        """Google Sheets omits trailing empty cells — we should fill them in."""
        self._setup_mock(svc, [
            ["First Name", "Last Name", "Email"],
            ["Alice"],  # missing last_name and email
        ])
        rows = svc.get_rows("fake_id", "Sheet1")
        assert rows[0]["Last Name"] == ""
        assert rows[0]["Email"] == ""

    def test_empty_sheet_returns_empty_list(self, svc):
        mock_values = svc._mock_client.spreadsheets.return_value.values.return_value
        mock_values.get.return_value.execute.return_value = {"values": []}
        assert svc.get_rows("fake_id", "Sheet1") == []


# ---------------------------------------------------------------------------
# _detect_field (auto-detection logic)
# ---------------------------------------------------------------------------

class TestDetectField:
    @pytest.mark.parametrize("header,expected", [
        ("Email Address", "email"),
        ("email", "email"),
        ("First Name", "first_name"),
        ("Last Name", "last_name"),
        ("Phone Number", "phone"),
        ("T-Shirt Size", "shirt_size"),
        ("Shirt Size Preference", "shirt_size"),
        ("Event Expertise (select all that apply)", "event_expertise"),
        ("Dietary Restrictions / Allergies", "dietary_restriction"),
        ("Lunch Order", "lunch_order"),
        ("Availability", "availability"),
        ("Timestamp", "__ignore__"),
        ("Something totally unrecognized", "__ignore__"),
    ])
    def test_detection(self, svc, header: str, expected: str):
        assert svc._detect_field(header) == expected