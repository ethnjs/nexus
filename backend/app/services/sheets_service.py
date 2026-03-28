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
    VOLUNTEER_KNOWN_FIELDS,
    FormQuestionOption,
    MappedHeader,
    ParseRule,
    SheetHeadersResponse,
    SheetValidateResponse,
)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/forms.body.readonly",
]

# ---------------------------------------------------------------------------
# Header auto-detection hints.
# Maps lowercase substrings → (field, type). More specific first.
# Only used as a fallback when no form question matches the header.
# ---------------------------------------------------------------------------
_HINT_IGNORE = ("__ignore__", "ignore")

HEADER_DETECTION_HINTS: list[tuple[str, tuple[str, str]]] = [
    ("first name",          ("first_name",  "string")),
    ("last name",           ("last_name",   "string")),
    ("email",               ("email",       "string")),
    ("phone",               ("phone",       "string")),
    ("shirt",               ("shirt_size",  "string")),
    ("t-shirt",             ("shirt_size",  "string")),
    ("dietary",             ("dietary_restriction", "string")),
    ("food",                ("dietary_restriction", "string")),
    ("allerg",              ("dietary_restriction", "string")),
    ("university",          ("university",  "string")),
    ("current employer",    ("employer",    "string")),
    ("employer",            ("employer",    "string")),
    ("what year are you",   ("major",       "string")),
    ("major",               ("major",       "string")),
    ("field of study",      ("major",       "string")),
    ("role preference",     ("role_preference",  "multi_select")),
    ("volunteering role",   ("role_preference",  "multi_select")),
    ("event preference",    ("event_preference", "multi_select")),
    ("event volunteer",     ("event_preference", "multi_select")),
    ("lunch",               ("lunch_order", "string")),
    ("limitation",          ("notes",       "string")),
    ("notes",               ("notes",       "string")),
    ("additional",          ("notes",       "string")),
    ("timestamp",           _HINT_IGNORE),
]

# Pattern for availability grid columns: "Availability [8:00 AM - 10:00 AM]"
_AVAILABILITY_PATTERN = re.compile(r"availability.+\[(.+)\]", re.IGNORECASE)

# The parse_time_range rule — auto-attached to availability matrix_row mappings
_PARSE_TIME_RANGE_RULE = ParseRule(
    condition="always", case_sensitive=False, action="parse_time_range"
)


class SheetsService:
    """
    Wraps the Google Sheets API.
    All Google API calls live here — routes never touch the client directly.
    """

    def __init__(self) -> None:
        settings = get_settings()

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
        sheet_type: str = "volunteers",
        form_questions: list | None = None,
    ) -> SheetHeadersResponse:
        """
        Fetch column headers from the sheet and return a flat SheetHeadersResponse.

        Each MappedHeader in response.mappings contains the suggested field mapping
        plus any form question enrichment (google_type, options, grid_rows, etc.)
        already cross-referenced — no client-side merging needed.

        Deduplication ensures no two headers suggest the same field or extra_key.
        availability matrix_row mappings always get a parse_time_range rule.
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

        q_index = _build_question_index(form_questions or [])

        claimed_fields: set[str] = set()
        claimed_extra_keys: set[str] = set()

        mappings: list[MappedHeader] = []
        for header in headers:
            mapped = _map_header(
                header, q_index, claimed_fields, claimed_extra_keys
            )
            mappings.append(mapped)

        known_fields = KNOWN_FIELDS_BY_TYPE.get(sheet_type, VOLUNTEER_KNOWN_FIELDS)

        return SheetHeadersResponse(
            sheet_name=sheet_name,
            sheet_type=sheet_type,
            mappings=mappings,
            known_fields=known_fields,
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


# ---------------------------------------------------------------------------
# Pure functions — outside the class for easy unit testing
# ---------------------------------------------------------------------------

def _build_question_index(form_questions: list) -> dict[str, dict]:
    """
    Build a lowercase-title → question-dict index from a list of FormQuestion
    objects. Also indexes grid row variants: "{title} [{row}]".
    """
    index: dict[str, dict] = {}
    for q in form_questions:
        qd = q.model_dump() if hasattr(q, "model_dump") else dict(q)
        title_lower = qd["title"].lower()
        index[title_lower] = qd
        for row in qd.get("grid_rows") or []:
            variant = f"{title_lower} [{row.lower()}]"
            index[variant] = qd
    return index


def _match_question(header_lower: str, q_index: dict) -> dict | None:
    """
    Match a lowercase sheet header to a form question.
    Tries exact match, then prefix match (handles truncated headers).
    """
    if header_lower in q_index:
        return q_index[header_lower]
    for title_lower, q in q_index.items():
        if header_lower.startswith(title_lower):
            return q
    return None


def _extract_row_key(header: str) -> str:
    """Extract the bracket-enclosed row key from a grid column header."""
    m = re.search(r"\[(.+)\]", header)
    return m.group(1).strip() if m else header.strip()


def _hint_from_title(title: str) -> tuple[str, str]:
    """Run hint detection against a title string. Falls back to extra_data/string."""
    lower = title.lower()
    for hint, (field, mapping_type) in HEADER_DETECTION_HINTS:
        if hint in lower:
            return field, mapping_type
    return "extra_data", "string"


def _alias_rules(options: list) -> list[ParseRule]:
    """
    Build ParseRule replace-rules from FormQuestionOptions where alias != raw.
    Only generates rules for modified options.
    """
    rules = []
    for opt in options:
        raw = opt.raw if hasattr(opt, "raw") else opt["raw"]
        alias = opt.alias if hasattr(opt, "alias") else opt["alias"]
        if raw != alias:
            rules.append(ParseRule(
                condition="contains",
                match=raw,
                case_sensitive=False,
                action="replace",
                value=alias,
            ))
    return rules


def _slugify(text: str, max_len: int = 50) -> str:
    """Convert a string to a snake_case key for use as extra_key."""
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug[:max_len]


def _dedup(
    field: str,
    mapping_type: str,
    extra_key: str | None,
    claimed_fields: set[str],
    claimed_extra_keys: set[str],
) -> tuple[str, str, str | None]:
    """
    Deduplicate field assignments so no two headers share a field or extra_key.

    - __ignore__ is never claimed.
    - extra_data: if extra_key already taken → fall back to ignore.
    - availability: never claimed (multiple matrix_row rows share it).
    - All other fields: if already claimed → fall back to ignore.
    """
    if field == "__ignore__":
        return field, mapping_type, extra_key

    if field == "extra_data":
        if extra_key and extra_key in claimed_extra_keys:
            return "__ignore__", "ignore", None
        if extra_key:
            claimed_extra_keys.add(extra_key)
        return field, mapping_type, extra_key

    if field in claimed_fields:
        return "__ignore__", "ignore", None

    # availability allows multiple matrix_row entries — don't block it
    if field != "availability":
        claimed_fields.add(field)

    return field, mapping_type, extra_key


def _map_header(
    header: str,
    q_index: dict,
    claimed_fields: set[str],
    claimed_extra_keys: set[str],
) -> MappedHeader:
    """
    Produce a MappedHeader for a single sheet column.

    Priority order:
    1. Form question match (if q_index populated)
    2. Hint-based detection
    3. Fall back to __ignore__
    """
    lower = header.lower()

    q = _match_question(lower, q_index)
    if q is not None:
        return _mapped_from_question(header, q, claimed_fields, claimed_extra_keys)

    return _mapped_from_hint(header, lower, claimed_fields, claimed_extra_keys)


def _mapped_from_question(
    header: str,
    q: dict,
    claimed_fields: set[str],
    claimed_extra_keys: set[str],
) -> MappedHeader:
    """Build a MappedHeader from a matched form question dict."""
    nexus_type: str = q["nexus_type"]
    google_type: str = q["google_type"]
    title: str = q["title"]
    options: list | None = q.get("options")
    grid_rows: list[str] | None = q.get("grid_rows")
    grid_columns: list[str] | None = q.get("grid_columns")

    # Grid questions → matrix_row, always get parse_time_range rule
    if nexus_type == "matrix_row":
        row_key = _extract_row_key(header)
        return MappedHeader(
            header=header,
            field="availability",
            type="matrix_row",
            row_key=row_key,
            rules=[_PARSE_TIME_RANGE_RULE],
            google_type=google_type,
            grid_rows=grid_rows,
            grid_columns=grid_columns,
        )

    # Choice/text questions — use hint to determine field
    hint_field, _ = _hint_from_title(title)
    field = hint_field
    mapping_type = nexus_type  # form type takes priority

    rules: list[ParseRule] | None = None
    if options and mapping_type == "multi_select":
        rules = _alias_rules(options) or None

    extra_key: str | None = None
    if field == "extra_data":
        extra_key = _slugify(title)

    field, mapping_type, extra_key = _dedup(
        field, mapping_type, extra_key, claimed_fields, claimed_extra_keys
    )

    # Convert raw option dicts to FormQuestionOption for output
    fq_options: list[FormQuestionOption] | None = None
    if options:
        fq_options = [
            FormQuestionOption(
                raw=o.raw if hasattr(o, "raw") else o["raw"],
                alias=o.alias if hasattr(o, "alias") else o["alias"],
            )
            for o in options
        ]

    return MappedHeader(
        header=header,
        field=field,
        type=mapping_type,
        extra_key=extra_key,
        rules=rules,
        google_type=google_type,
        options=fq_options,
    )


def _mapped_from_hint(
    header: str,
    lower: str,
    claimed_fields: set[str],
    claimed_extra_keys: set[str],
) -> MappedHeader:
    """Build a MappedHeader using hint-based detection (no form data available)."""
    # Availability grid pattern
    avail_match = _AVAILABILITY_PATTERN.search(header)
    if avail_match:
        row_key = avail_match.group(1).strip()
        return MappedHeader(
            header=header,
            field="availability",
            type="matrix_row",
            row_key=row_key,
            rules=[_PARSE_TIME_RANGE_RULE],
        )

    for hint, (field, mapping_type) in HEADER_DETECTION_HINTS:
        if hint in lower:
            extra_key: str | None = None
            if field == "extra_data":
                extra_key = _slugify(header)
            field, mapping_type, extra_key = _dedup(
                field, mapping_type, extra_key, claimed_fields, claimed_extra_keys
            )
            return MappedHeader(
                header=header,
                field=field,
                type=mapping_type,
                extra_key=extra_key or None,
            )

    return MappedHeader(
        header=header,
        field="__ignore__",
        type="ignore",
    )