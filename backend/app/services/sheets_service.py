"""
Google Sheets API wrapper + header mapping logic.

SheetsService handles all Google Sheets API calls.
Pure functions handle header → field/type mapping with this priority:
  1. Form question match → field from hints, type from form's nexus_type
  2. Hint-based detection → field from hints, type defaults to "string"
  3. Fall back to __ignore__/ignore

Exception: availability bracket pattern always → matrix_row regardless of form data.
"""
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
from app.services.volunteer_hints import (
    AVAILABILITY_BRACKET_PATTERN,
    FieldHint,
    match_volunteer_hint,
)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/forms.body.readonly",
]

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
        plus any form question enrichment (options, grid_rows, etc.)
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
        for column_index, header in enumerate(headers):
            mapped = _map_header(
                header, column_index, q_index, claimed_fields, claimed_extra_keys
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
        headers, rows = self.get_rows_with_headers(
            spreadsheet_id=spreadsheet_id,
            sheet_name=sheet_name,
            skip_header=skip_header,
        )
        result_dicts: list[dict[str, Any]] = []
        for row in rows:
            padded = row + [""] * (len(headers) - len(row))
            result_dicts.append(dict(zip(headers, padded)))
        return result_dicts

    def get_rows_with_headers(
        self, spreadsheet_id: str, sheet_name: str, skip_header: bool = True
    ) -> tuple[list[str], list[list[str]]]:
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
            return ([], [])

        headers = rows[0]
        data_rows = rows[1:] if skip_header else rows
        return headers, data_rows


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


def _hint_field(title: str) -> FieldHint:
    """
    Run hint detection against a title string.
    Falls back to FieldHint(field="extra_data") with a slugified extra_key.
    """
    hint = match_volunteer_hint(title.lower())
    if hint is not None:
        return hint
    return FieldHint(field="extra_data", extra_key=_slugify(title))


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


def _infer_grid_field(
    title: str,
    grid_rows: list[str] | None,
    grid_columns: list[str] | None,
) -> str:
    """
    Infer matrix_row field with grid-aware heuristics.

    Matrix questions should map to either availability or event_preference.
    Generic hints like "major" in long question text should not override this.
    """
    title_lower = title.lower()
    rows_lower = [r.lower() for r in (grid_rows or [])]
    cols_lower = [c.lower() for c in (grid_columns or [])]

    def _looks_like_time_label(text: str) -> bool:
        # Strict-ish time parsing so words like "Anatomy" do not trigger on "am".
        return (
            bool(re.search(r"\b\d{1,2}:\d{2}\s*(am|pm)\b", text))
            or bool(re.search(r"\b\d{1,2}\s*(am|pm)\b", text))
            or "noon" in text
            or "midnight" in text
        )

    # Availability intent from title or row labels.
    if (
        "availability" in title_lower
        or "available" in title_lower
        or any(_looks_like_time_label(r) for r in rows_lower)
    ):
        return "availability"

    # Event preference intent from title/columns/rows.
    if (
        any(k in title_lower for k in ("event", "supervis", "top 3", "choice"))
        or any("choice" in c or "preference" in c or c in {"1st", "2nd", "3rd"} for c in cols_lower)
        or any("(b)" in r or "(c)" in r or "(b/c)" in r for r in rows_lower)
    ):
        return "event_preference"

    # Fallback to hint on title only if it yields one of the allowed grid fields.
    hinted = _hint_field(title).field
    if hinted in {"availability", "event_preference"}:
        return hinted

    # Safe grid default.
    return "availability"


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
    - event_preference: never claimed (multiple grid rows can share it).
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

    # availability and event_preference allow multiple entries (grid rows)
    if field not in ("availability", "event_preference"):
        claimed_fields.add(field)

    return field, mapping_type, extra_key


def _map_header(
    header: str,
    column_index: int,
    q_index: dict,
    claimed_fields: set[str],
    claimed_extra_keys: set[str],
) -> MappedHeader:
    """
    Produce a MappedHeader for a single sheet column.

    Priority order:
    1. Form question match (if q_index populated)
    2. Hint-based detection (field only, type defaults to "string")
    3. Fall back to __ignore__/ignore
    """
    lower = header.lower()

    q = _match_question(lower, q_index)
    if q is not None:
        return _mapped_from_question(header, column_index, q, claimed_fields, claimed_extra_keys)

    return _mapped_from_hint(header, column_index, lower, claimed_fields, claimed_extra_keys)


def _mapped_from_question(
    header: str,
    column_index: int,
    q: dict,
    claimed_fields: set[str],
    claimed_extra_keys: set[str],
) -> MappedHeader:
    """
    Build a MappedHeader from a matched form question dict.

    Field comes from hints (semantic meaning of the question title).
    Type comes from the form question's nexus_type (google question type).
    """
    nexus_type: str = q["nexus_type"]
    title: str = q["title"]
    options: list | None = q.get("options")
    grid_rows: list[str] | None = q.get("grid_rows")
    grid_columns: list[str] | None = q.get("grid_columns")

    # Grid questions → matrix_row, always get parse_time_range rule
    if nexus_type == "matrix_row":
        # Determine field with grid-aware inference so generic keywords like
        # "major" inside long event question text do not misclassify.
        grid_field = _infer_grid_field(title, grid_rows, grid_columns)

        row_key = _extract_row_key(header)

        rules: list[ParseRule] | None = None
        if grid_field == "availability":
            rules = [_PARSE_TIME_RANGE_RULE]

        return MappedHeader(
            column_index=column_index,
            header=header,
            field=grid_field,
            type="matrix_row",
            row_key=row_key,
            rules=rules,
            grid_rows=grid_rows,
            grid_columns=grid_columns,
        )

    # Non-grid questions — field from hint, type from form
    hint = _hint_field(title)
    field = hint.field
    mapping_type = nexus_type  # form type takes priority

    rules = None
    if options and mapping_type == "multi_select":
        rules = _alias_rules(options) or None

    extra_key: str | None = hint.extra_key
    if field == "extra_data" and not extra_key:
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
        column_index=column_index,
        header=header,
        field=field,
        type=mapping_type,
        extra_key=extra_key,
        rules=rules,
        options=fq_options,
    )


def _mapped_from_hint(
    header: str,
    column_index: int,
    lower: str,
    claimed_fields: set[str],
    claimed_extra_keys: set[str],
) -> MappedHeader:
    """
    Build a MappedHeader using hint-based detection (no form data available).

    Field comes from hints. Type always defaults to "string" except for
    the availability bracket pattern which forces "matrix_row".
    """
    # Availability grid pattern: "Availability [8:00 AM - 10:00 AM]"
    avail_match = AVAILABILITY_BRACKET_PATTERN.search(header)
    if avail_match:
        row_key = avail_match.group(1).strip()
        return MappedHeader(
            column_index=column_index,
            header=header,
            field="availability",
            type="matrix_row",
            row_key=row_key,
            rules=[_PARSE_TIME_RANGE_RULE],
        )

    # Try volunteer hints — field only, type defaults to "string"
    hint = match_volunteer_hint(lower)
    if hint is not None:
        field = hint.field
        extra_key = hint.extra_key

        # __ignore__ → ignore type
        if field == "__ignore__":
            return MappedHeader(column_index=column_index, header=header, field="__ignore__", type="ignore")

        # extra_data without a pre-defined extra_key → slugify the header
        if field == "extra_data" and not extra_key:
            extra_key = _slugify(header)

        mapping_type = "string"
        field, mapping_type, extra_key = _dedup(
            field, mapping_type, extra_key, claimed_fields, claimed_extra_keys
        )

        return MappedHeader(
            column_index=column_index,
            header=header,
            field=field,
            type=mapping_type,
            extra_key=extra_key or None,
        )

    # No match at all → ignore
    return MappedHeader(
        column_index=column_index,
        header=header,
        field="__ignore__",
        type="ignore",
    )
