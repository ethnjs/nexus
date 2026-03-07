"""
SheetsService wraps the Google Sheets API.

All Google API calls live here. Routes never touch the Google client directly.
This makes the service easy to mock in tests.
"""

from __future__ import annotations
import re
from typing import Any
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.core.config import get_settings
from app.schemas.sheet_config import (
    KNOWN_FIELDS,
    SheetValidateResponse,
    SheetHeadersResponse,
)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# ---------------------------------------------------------------------------
# Auto-detection: maps lowercase substrings found in a header to a DB field.
# Order matters — more specific patterns should come first.
# ---------------------------------------------------------------------------
HEADER_DETECTION_HINTS: list[tuple[str, str]] = [
    ("first name", "first_name"),
    ("last name", "last_name"),
    ("email", "email"),
    ("phone", "phone"),
    ("shirt", "shirt_size"),
    ("dietary", "dietary_restriction"),
    ("food", "dietary_restriction"),
    ("allerg", "dietary_restriction"),
    ("event expertise", "event_expertise"),
    ("expertise", "event_expertise"),
    ("event preference", "event_preference"),
    ("prefer", "event_preference"),
    ("availability", "availability"),
    ("lunch", "lunch_order"),
    ("meal", "lunch_order"),
    ("note", "notes"),
    ("comment", "notes"),
    ("timestamp", "__ignore__"),
]


class SheetsService:
    """
    Provides sheet validation, header extraction, and row reading.
    Authenticates once using the hardcoded service account file.
    """

    def __init__(self) -> None:
        settings = get_settings()
        credentials = service_account.Credentials.from_service_account_file(
            settings.google_service_account_file, scopes=SCOPES
        )
        self._client = build("sheets", "v4", credentials=credentials, cache_discovery=False)

    # ------------------------------------------------------------------
    # Public methods
    # ------------------------------------------------------------------

    def extract_spreadsheet_id(self, sheet_url: str) -> str:
        """
        Parse the spreadsheet ID out of a Google Sheets URL.

        Supports both formats:
          https://docs.google.com/spreadsheets/d/{ID}/edit#gid=0
          https://docs.google.com/spreadsheets/d/{ID}/
        """
        match = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", sheet_url)
        if not match:
            raise ValueError(f"Could not extract spreadsheet ID from URL: {sheet_url}")
        return match.group(1)

    def validate_sheet_url(self, sheet_url: str) -> SheetValidateResponse:
        """
        Confirm the service account can access the spreadsheet.
        Returns the title and list of sheet/tab names.
        """
        spreadsheet_id = self.extract_spreadsheet_id(sheet_url)
        try:
            metadata = (
                self._client.spreadsheets()
                .get(spreadsheetId=spreadsheet_id)
                .execute()
            )
        except HttpError as e:
            if e.resp.status == 403:
                raise PermissionError(
                    "Service account does not have access to this spreadsheet. "
                    "Share the sheet with the service account email."
                )
            if e.resp.status == 404:
                raise ValueError("Spreadsheet not found. Check the URL.")
            raise

        title = metadata.get("properties", {}).get("title", "Untitled")
        sheet_names = [s["properties"]["title"] for s in metadata.get("sheets", [])]

        return SheetValidateResponse(
            spreadsheet_id=spreadsheet_id,
            spreadsheet_title=title,
            sheet_names=sheet_names,
        )

    def get_headers(self, sheet_url: str, sheet_name: str) -> SheetHeadersResponse:
        """
        Read the first row of the given tab and return headers.
        Also returns auto-detected field suggestions for the mapper UI.
        """
        spreadsheet_id = self.extract_spreadsheet_id(sheet_url)
        range_notation = f"'{sheet_name}'!1:1"

        try:
            result = (
                self._client.spreadsheets()
                .values()
                .get(spreadsheetId=spreadsheet_id, range=range_notation)
                .execute()
            )
        except HttpError as e:
            if e.resp.status == 403:
                raise PermissionError("Service account cannot read this sheet.")
            raise

        rows = result.get("values", [])
        headers: list[str] = rows[0] if rows else []

        suggestions = {header: self._detect_field(header) for header in headers}

        return SheetHeadersResponse(
            sheet_name=sheet_name,
            headers=headers,
            suggestions=suggestions,
        )

    def get_rows(
        self, spreadsheet_id: str, sheet_name: str, skip_header: bool = True
    ) -> list[dict[str, Any]]:
        """
        Read all rows from a sheet tab.
        Returns a list of dicts keyed by column header (row 0).
        Used later by the sync service to import volunteer data.
        """
        range_notation = f"'{sheet_name}'"
        try:
            result = (
                self._client.spreadsheets()
                .values()
                .get(spreadsheetId=spreadsheet_id, range=range_notation)
                .execute()
            )
        except HttpError as e:
            if e.resp.status == 403:
                raise PermissionError("Service account cannot read this sheet.")
            raise

        rows = result.get("values", [])
        if not rows:
            return []

        headers = rows[0]
        data_rows = rows[1:] if skip_header else rows

        result_dicts = []
        for row in data_rows:
            # Pad short rows so every header has a value (Google omits trailing blanks)
            padded = row + [""] * (len(headers) - len(row))
            result_dicts.append(dict(zip(headers, padded)))

        return result_dicts

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _detect_field(self, header: str) -> str:
        """
        Fuzzy-match a column header to a known DB field.
        Falls back to "__ignore__" if nothing matches.
        """
        lower = header.lower()
        for pattern, field in HEADER_DETECTION_HINTS:
            if pattern in lower:
                return field
        return "__ignore__"