from __future__ import annotations
import json
import re
from typing import Any
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.core.config import get_settings
from app.schemas.sheet_config import (
    KNOWN_FIELDS_BY_TYPE,
    ColumnMapping,
    FormQuestion,
    ParseRule,
    SheetValidateResponse,
    SheetHeadersResponse,
)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/forms.body.readonly",
]

# ---------------------------------------------------------------------------
# Auto-detection hints — maps lowercase substrings in a header to a
# ColumnMapping. Used as a fallback when no form metadata is available,
# and as a secondary signal when form cross-referencing is inconclusive.
# More specific patterns must come before general ones.
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

    def get_headers(
        self,
        sheet_url: str,
        sheet_name: str,
        sheet_type: str,
        form_questions: list[FormQuestion] | None = None,
    ) -> SheetHeadersResponse:
        """
        Fetch the first row of the sheet as column headers and return
        auto-detected mapping suggestions.

        When form_questions is provided (volunteers sheets), suggestions are
        enriched using form metadata — question type drives the ColumnMapping
        type, and option aliases are attached for choice questions. The header-
        hint fallback still runs for any column that couldn't be matched to a
        form question.
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

        # Build a title → FormQuestion index for O(1) lookups
        question_index = _build_question_index(form_questions or [])

        suggestions: dict[str, ColumnMapping] = {}
        for header in headers:
            matched_question = _match_header_to_question(header, question_index)
            if matched_question:
                suggestions[header] = _question_to_mapping(header, matched_question)
            else:
                suggestions[header] = self._detect_field(header)

        return SheetHeadersResponse(
            sheet_name=sheet_name,
            sheet_type=sheet_type,
            headers=headers,
            suggestions=suggestions,
            known_fields=KNOWN_FIELDS_BY_TYPE.get(sheet_type, []),
            form_questions=form_questions,
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
        Fuzzy-match a column header to a ColumnMapping using HEADER_DETECTION_HINTS.
        Handles availability matrix rows specially via AVAILABILITY_PATTERN.
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


# ---------------------------------------------------------------------------
# Form question → ColumnMapping helpers (module-level, pure functions)
# ---------------------------------------------------------------------------

def _build_question_index(
    questions: list[FormQuestion],
) -> dict[str, FormQuestion]:
    """
    Build a lowercase title → FormQuestion lookup dict.
    For grid questions, also indexes each grid row variant:
      "{question title} [{row}]" — the pattern Google Sheets uses for grid columns.
    """
    index: dict[str, FormQuestion] = {}
    for q in questions:
        index[q.title.lower()] = q
        if q.grid_rows:
            for row in q.grid_rows:
                key = f"{q.title.lower()} [{row.lower()}]"
                index[key] = q
    return index


def _match_header_to_question(
    header: str,
    question_index: dict[str, FormQuestion],
) -> FormQuestion | None:
    """
    Try to match a sheet column header to a FormQuestion.

    Matching strategy (in order):
      1. Exact lowercase match on question title
      2. Sheet header starts with question title (handles Google's truncation)
      3. Grid row variant: "{title} [{row}]" exact match
    """
    lower = header.lower()

    # Exact match
    if lower in question_index:
        return question_index[lower]

    # Prefix match — sheet header starts with question title
    for title_lower, question in question_index.items():
        if lower.startswith(title_lower):
            return question

    return None


def _question_to_mapping(header: str, question: FormQuestion) -> ColumnMapping:
    """
    Convert a matched FormQuestion into a ColumnMapping suggestion.

    - matrix_row: extracts row_key from the bracket portion of the header
      and attaches a parse_availability rule automatically.
    - multi_select: attaches replace rules derived from option aliases so the
      raw option strings are normalized to their aliases before storage.
    - All other types: straightforward field + type suggestion from hints,
      falling back to extra_data string if no hint matches.
    """
    if question.nexus_type == "matrix_row":
        return _grid_header_to_mapping(header, question)

    # Try to get a field suggestion from hints using the question title
    hint_mapping = _hint_from_title(question.title)

    if question.nexus_type == "multi_select":
        field = hint_mapping.field if hint_mapping else "extra_data"
        extra_key = hint_mapping.extra_key if hint_mapping else None
        rules = _alias_rules(question)
        return ColumnMapping(
            field=field,
            type="multi_select",
            extra_key=extra_key,
            rules=rules if rules else None,
        )

    # string / integer / boolean
    if hint_mapping:
        return hint_mapping
    return ColumnMapping(field="extra_data", type="string", extra_key=_slugify(question.title))


def _grid_header_to_mapping(header: str, question: FormQuestion) -> ColumnMapping:
    """
    Build a matrix_row ColumnMapping for a grid question column header.
    Extracts the row_key from the bracket suffix Google Sheets appends,
    e.g. "Availability [8:00 AM - 10:00 AM]" → row_key = "8:00 AM - 10:00 AM".
    Attaches a parse_availability rule automatically.
    """
    avail_match = AVAILABILITY_PATTERN.search(header)
    if avail_match:
        row_key = avail_match.group(1).strip()
    else:
        # Fall back to looking for [bracket content] anywhere in the header
        bracket_match = re.search(r"\[(.+)\]", header)
        row_key = bracket_match.group(1).strip() if bracket_match else header

    return ColumnMapping(
        field="availability",
        type="matrix_row",
        row_key=row_key,
        rules=[ParseRule(condition="always", action="parse_availability")],
    )


def _alias_rules(question: FormQuestion) -> list[ParseRule]:
    """
    Build replace rules that normalize raw option strings to their aliases.
    One rule per option where the alias differs from the raw value.
    Rules use contains condition so they fire even when the option appears
    as part of a comma-joined multi-select cell value.
    """
    if not question.options:
        return []

    rules = []
    for opt in question.options:
        if opt.raw != opt.alias:
            rules.append(ParseRule(
                condition="contains",
                match=opt.raw,
                case_sensitive=False,
                action="replace",
                value=opt.alias,
            ))
    return rules


def _hint_from_title(title: str) -> ColumnMapping | None:
    """Run HEADER_DETECTION_HINTS against a question title as a fallback."""
    lower = title.lower()
    avail_match = AVAILABILITY_PATTERN.search(title)
    if avail_match:
        row_key = avail_match.group(1).strip()
        return ColumnMapping(field="availability", type="matrix_row", row_key=row_key)
    for pattern, mapping in HEADER_DETECTION_HINTS:
        if pattern in lower:
            return mapping
    return None


def _slugify(text: str) -> str:
    """Convert a question title to a snake_case extra_key."""
    slug = text.lower().strip()
    slug = re.sub(r"[^\w\s]", "", slug)
    slug = re.sub(r"\s+", "_", slug)
    return slug[:50]  # cap length for DB storage