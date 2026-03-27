from __future__ import annotations
import json
import re
from typing import Any
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.core.config import get_settings
from app.schemas.sheet_config import (
    KNOWN_FIELDS,
    ColumnMapping,
    SheetValidateResponse,
    SheetHeadersResponse,
)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# ---------------------------------------------------------------------------
# Auto-detection hints — maps lowercase substrings in a header to a
# ColumnMapping. More specific patterns must come before general ones.
# ---------------------------------------------------------------------------
HEADER_DETECTION_HINTS: list[tuple[str, ColumnMapping]] = [
    # Identity — string fields (more specific patterns first)
    ("first name",          ColumnMapping(field="first_name",  type="string")),
    ("last name",           ColumnMapping(field="last_name",   type="string")),
    ("email",               ColumnMapping(field="email",       type="string")),
    ("phone",               ColumnMapping(field="phone",       type="string")),
    ("shirt",               ColumnMapping(field="shirt_size",  type="string")),
    ("t-shirt",             ColumnMapping(field="shirt_size",  type="string")),
    ("dietary",             ColumnMapping(field="dietary_restriction", type="string")),
    ("food",                ColumnMapping(field="dietary_restriction", type="string")),
    ("allerg",              ColumnMapping(field="dietary_restriction", type="string")),

    # User profile — university/employer/major
    ("university",          ColumnMapping(field="university",  type="string")),
    ("current employer",    ColumnMapping(field="employer",    type="string")),
    ("employer",            ColumnMapping(field="employer",    type="string")),
    ("what year are you",   ColumnMapping(field="major",       type="string")),
    ("major",               ColumnMapping(field="major",       type="string")),
    ("field of study",      ColumnMapping(field="major",       type="string")),

    # Role & preference
    ("volunteering role preference", ColumnMapping(field="role_preference",  type="multi_select")),
    ("role preference",              ColumnMapping(field="role_preference",  type="multi_select")),
    # event_preference: suggested as multi_select — TD adds parse rules to normalize
    ("if interested in event",       ColumnMapping(field="event_preference", type="multi_select")),
    ("which event",                  ColumnMapping(field="event_preference", type="multi_select")),
    ("event preference",             ColumnMapping(field="event_preference", type="multi_select")),
    ("if you are interested in general", ColumnMapping(field="extra_data", type="multi_select", extra_key="general_volunteer_interest")),
    ("general volunteer",            ColumnMapping(field="extra_data", type="multi_select", extra_key="general_volunteer_interest")),

    # Availability — matrix rows handled specially via AVAILABILITY_PATTERN

    # Logistics
    ("lunch",               ColumnMapping(field="lunch_order", type="string")),
    ("meal",                ColumnMapping(field="lunch_order", type="string")),
    ("limitation",          ColumnMapping(field="notes",       type="string")),
    ("note",                ColumnMapping(field="notes",       type="string")),
    ("comment",             ColumnMapping(field="notes",       type="string")),

    # Science Olympiad background — extra_data with standard keys
    ("coming from",         ColumnMapping(field="extra_data",  type="string",  extra_key="location")),
    ("conflict of interest",ColumnMapping(field="extra_data",  type="string",  extra_key="conflict_of_interest")),
    ("competed in the past",ColumnMapping(field="extra_data",  type="boolean", extra_key="scioly_competed")),
    ("competed in science", ColumnMapping(field="extra_data",  type="boolean", extra_key="scioly_competed")),
    ("events competed in",  ColumnMapping(field="extra_data",  type="string",  extra_key="scioly_competed_events")),
    ("schools you represented", ColumnMapping(field="extra_data", type="string", extra_key="scioly_schools")),
    ("volunteered for past",ColumnMapping(field="extra_data",  type="boolean", extra_key="scioly_volunteered")),
    ("volunteered for",     ColumnMapping(field="extra_data",  type="boolean", extra_key="scioly_volunteered")),
    ("describe your experience", ColumnMapping(field="extra_data", type="string", extra_key="scioly_experience")),
    ("expertise",           ColumnMapping(field="extra_data",  type="string",  extra_key="scioly_experience")),
    ("how many people can you take", ColumnMapping(field="extra_data", type="integer", extra_key="carpool_seats")),
    ("how will you get",    ColumnMapping(field="extra_data",  type="string",  extra_key="transportation")),

    # Only ignore fields that are truly never useful
    ("timestamp",           ColumnMapping(field="__ignore__",  type="ignore")),
    ("how did you hear",    ColumnMapping(field="__ignore__",  type="ignore")),
]

# Regex to detect availability matrix row headers
# e.g. "Availability from 5/21 to 5/23 [8:00 AM - 10:00 AM]"
AVAILABILITY_PATTERN = re.compile(r"availability.+\[(.+)\]", re.IGNORECASE)


class SheetsService:
    """
    Wraps the Google Sheets API.
    All Google API calls live here — routes never touch the client directly.
    """

    def __init__(self) -> None:
        settings = get_settings()

        # Production: load credentials from JSON env var
        # Development: load credentials from file
        if settings.google_service_account_json:
            service_account_info = json.loads(settings.google_service_account_json)
            credentials = service_account.Credentials.from_service_account_info(
                service_account_info, scopes=SCOPES
            )
        else:
            credentials = service_account.Credentials.from_service_account_file(
                settings.google_service_account_file, scopes=SCOPES
            )

        self._client = build("sheets", "v4", credentials=credentials, cache_discovery=False)

    # ------------------------------------------------------------------
    # Public methods
    # ------------------------------------------------------------------

    def extract_spreadsheet_id(self, sheet_url: str) -> str:
        match = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", sheet_url)
        if not match:
            raise ValueError(f"Could not extract spreadsheet ID from URL: {sheet_url}")
        return match.group(1)

    def validate_sheet_url(self, sheet_url: str) -> SheetValidateResponse:
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
        suggestions = {h: self._detect_field(h) for h in headers}

        return SheetHeadersResponse(
            sheet_name=sheet_name,
            headers=headers,
            suggestions=suggestions,
        )

    def get_rows(
        self, spreadsheet_id: str, sheet_name: str, skip_header: bool = True
    ) -> list[dict[str, Any]]:
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
            padded = row + [""] * (len(headers) - len(row))
            result_dicts.append(dict(zip(headers, padded)))

        return result_dicts

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _detect_field(self, header: str) -> ColumnMapping:
        """
        Fuzzy-match a column header to a ColumnMapping.
        Handles availability matrix rows specially.
        Falls back to ignore if nothing matches.
        """
        lower = header.lower()

        # Check for availability matrix row first
        avail_match = AVAILABILITY_PATTERN.search(header)
        if avail_match:
            row_key = avail_match.group(1).strip()
            return ColumnMapping(field="availability", type="matrix_row", row_key=row_key)

        # Check hints in order
        for pattern, mapping in HEADER_DETECTION_HINTS:
            if pattern in lower:
                return mapping

        return ColumnMapping(field="__ignore__", type="ignore")