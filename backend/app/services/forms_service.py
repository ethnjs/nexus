from __future__ import annotations
import json
import re
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.core.config import get_settings
from app.schemas.sheet_config import (
    FORMS_TYPE_MAP,
    FormQuestionOption,
)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/forms.body.readonly",
]

# ---------------------------------------------------------------------------
# Alias auto-suggestion patterns.
# Applied in order — first match that produces a non-empty result wins.
# Strips "yap" that form authors add for respondent clarity.
#
# Examples:
#   "Anatomy and Physiology - Study the human body"  → "Anatomy and Physiology"
#   "Chemistry Lab (hands-on lab work)"              → "Chemistry Lab"
#   "Yes, I am available"                            → "Yes"
# ---------------------------------------------------------------------------
_ALIAS_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\s+-\s+.+$"),       ""),  # " - anything after a dash"
    (re.compile(r"\s+\([^)]+\)\s*$"), ""),  # " (parenthetical at the end)"
    (re.compile(r",\s+.+$"),          ""),  # ", anything after a comma"
]


def _suggest_alias(raw: str) -> str:
    """
    Auto-suggest a short alias for a raw form option string.
    Applies _ALIAS_PATTERNS in order; returns the first non-empty result,
    or the raw value unchanged if nothing matched.
    """
    for pattern, replacement in _ALIAS_PATTERNS:
        candidate = pattern.sub(replacement, raw).strip()
        if candidate and candidate != raw.strip():
            return candidate
    return raw.strip()


# ---------------------------------------------------------------------------
# Internal question dict shape returned by FormsService.
# Uses google_type (raw Forms API type) instead of nexus_type so the
# sheets_service layer can make its own type mapping decisions.
# ---------------------------------------------------------------------------
def _make_question(
    question_id: str,
    title: str,
    google_type: str,
    nexus_type: str,
    options: list[FormQuestionOption] | None = None,
    grid_rows: list[str] | None = None,
    grid_columns: list[str] | None = None,
) -> dict:
    return {
        "question_id":  question_id,
        "title":        title,
        "google_type":  google_type,   # raw Forms API type string
        "nexus_type":   nexus_type,    # mapped NEXUS type (for sheets_service)
        "options":      options,
        "grid_rows":    grid_rows,
        "grid_columns": grid_columns,
    }


class FormsService:
    """
    Wraps the Google Forms API.
    Reads form structure (question types, titles, options) to enrich
    the sheet mapping wizard with form-native suggestions.

    Uses the same service account credentials as SheetsService — the form
    must be shared with the service account email as a viewer.
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

        self._client = build("forms", "v1", credentials=credentials, cache_discovery=False)

    # ------------------------------------------------------------------
    # Public methods
    # ------------------------------------------------------------------

    def extract_form_id(self, form_url: str) -> str:
        """Extract the form ID from a Google Forms URL."""
        match = re.search(r"/forms/d/([a-zA-Z0-9_-]+)", form_url)
        if not match:
            raise ValueError(f"Could not extract form ID from URL: {form_url}")
        return match.group(1)

    def get_form_questions(self, form_url: str) -> list[dict]:
        """
        Fetch all answerable questions from a Google Form.

        Returns a list of question dicts with keys:
            question_id, title, google_type, nexus_type,
            options (list[FormQuestionOption] | None),
            grid_rows (list[str] | None),
            grid_columns (list[str] | None)

        Grid questions are returned as a single dict with grid_rows/grid_columns
        populated — the sheets_service layer expands these into multiple
        matrix_row MappedHeaders, one per grid row.

        Raises PermissionError if the service account cannot access the form.
        Raises ValueError if the URL is invalid or the form is not found.
        """
        form_id = self.extract_form_id(form_url)

        try:
            form = self._client.forms().get(formId=form_id).execute()
        except HttpError as e:
            if e.resp.status == 403:
                raise PermissionError(
                    "Service account does not have access to this form. "
                    "Share the form with the service account email."
                )
            if e.resp.status == 404:
                raise ValueError("Form not found. Check the URL.")
            raise

        questions: list[dict] = []

        for item in form.get("items", []):
            # Handle questionGroupItem (grid questions)
            question_group = item.get("questionGroupItem")
            if question_group:
                title = item.get("title", "").strip()
                parsed = self._parse_question_group(title, question_group)
                if parsed:
                    questions.append(parsed)
                continue

            # Handle regular questionItem
            question_item = item.get("questionItem")
            if not question_item:
                # Section headers, images, videos — skip
                continue

            question = question_item.get("question", {})
            question_id = question.get("questionId", "")
            title = item.get("title", "").strip()

            # Check for paragraph text — textQuestion with paragraph: true
            text_q = question.get("textQuestion")
            if text_q and text_q.get("paragraph"):
                questions.append(
                    _make_question(question_id, title, "PARAGRAPH_TEXT", "string")
                )
                continue

            parsed = self._parse_question(question_id, title, question)
            if parsed:
                questions.append(parsed)

        return questions

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _parse_question(
        self,
        question_id: str,
        title: str,
        question: dict,
    ) -> dict | None:
        """
        Parse a single Forms API question dict into our internal question dict.
        Returns None for question types we don't handle (e.g. FILE_UPLOAD).
        """
        if "choiceQuestion" in question:
            return self._parse_choice(question_id, title, question["choiceQuestion"])
        if "textQuestion" in question:
            return _make_question(question_id, title, "TEXT", "string")
        if "scaleQuestion" in question:
            return _make_question(question_id, title, "LINEAR_SCALE", "integer")
        if "dateQuestion" in question:
            return _make_question(question_id, title, "DATE", "string")
        if "timeQuestion" in question:
            return _make_question(question_id, title, "TIME", "string")

        return None

    def _parse_choice(
        self,
        question_id: str,
        title: str,
        choice: dict,
    ) -> dict:
        """MULTIPLE_CHOICE (radio), CHECKBOX (multi-select), DROP_DOWN."""
        google_type = choice.get("type", "MULTIPLE_CHOICE")
        nexus_type = FORMS_TYPE_MAP.get(google_type, "string")

        raw_options = [opt.get("value", "") for opt in choice.get("options", [])
                       if not opt.get("isOther")]
        options = [
            FormQuestionOption(raw=raw, alias=_suggest_alias(raw))
            for raw in raw_options
            if raw
        ]

        return _make_question(
            question_id, title, google_type, nexus_type, options=options
        )

    def _parse_question_group(
        self,
        title: str,
        group: dict,
    ) -> dict | None:
        """
        Parse a questionGroupItem (grid question).

        Grid questions have rows (individual sub-questions) and columns
        (the response options). In the sheet, each row becomes its own column
        with header pattern: "{title} [{row_title}]".

        Returns a single question dict with grid_rows and grid_columns populated.
        """
        questions = group.get("questions", [])
        grid = group.get("grid", {})

        if not questions or not grid:
            return None

        # Extract row labels from rowQuestion titles
        rows = []
        first_question_id = ""
        for q in questions:
            if not first_question_id:
                first_question_id = q.get("questionId", "")
            row_q = q.get("rowQuestion", {})
            row_title = row_q.get("title", "")
            if row_title:
                rows.append(row_title)

        # Extract column labels from grid columns
        columns_data = grid.get("columns", {})
        columns = [
            c.get("value", "")
            for c in columns_data.get("options", [])
            if c.get("value")
        ]

        if not rows:
            return None

        return _make_question(
            first_question_id, title, "GRID", "matrix_row",
            grid_rows=rows, grid_columns=columns,
        )