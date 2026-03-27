from __future__ import annotations
import json
import re
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.core.config import get_settings
from app.schemas.sheet_config import (
    FORMS_TYPE_MAP,
    FormQuestion,
    FormQuestionOption,
)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/forms.body.readonly",
]

# ---------------------------------------------------------------------------
# Alias auto-suggestion patterns.
# Applied in order — first match wins. Each is a (pattern, replacement) pair
# where pattern is a regex applied to the raw option string.
#
# The goal is to strip the "yap" that form authors add for respondent clarity
# but that clutters dashboard display. Examples:
#   "Anatomy and Physiology - Study the human body"  → "Anatomy and Physiology"
#   "Chemistry Lab (hands-on lab work)"              → "Chemistry Lab"
#   "Yes, I am available"                            → "Yes"
# ---------------------------------------------------------------------------
_ALIAS_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # " - anything after a dash separator"
    (re.compile(r"\s+-\s+.+$"), ""),
    # " (anything in parentheses at the end)"
    (re.compile(r"\s+\([^)]+\)\s*$"), ""),
    # ", anything after a comma"
    (re.compile(r",\s+.+$"), ""),
]


def _suggest_alias(raw: str) -> str:
    """
    Auto-suggest a short alias for a raw form option string.
    Applies _ALIAS_PATTERNS in order; returns the first result that
    produces a non-empty string, otherwise returns the raw value as-is.
    """
    for pattern, replacement in _ALIAS_PATTERNS:
        candidate = pattern.sub(replacement, raw).strip()
        if candidate:
            return candidate
    return raw.strip()


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

    def get_form_questions(self, form_url: str) -> list[FormQuestion]:
        """
        Fetch all answerable questions from a Google Form and return them
        as structured FormQuestion objects ready for the mapping wizard.

        Grid questions (CHECKBOX_GRID / MULTIPLE_CHOICE_GRID) are returned
        as a single FormQuestion with grid_rows and grid_columns populated —
        the sheet mapping layer expands these into multiple matrix_row
        ColumnMappings, one per grid row.

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

        questions: list[FormQuestion] = []

        for item in form.get("items", []):
            question_item = item.get("questionItem")
            if not question_item:
                # Section headers, images, videos — skip
                continue

            question = question_item.get("question", {})
            question_id = question.get("questionId", "")
            title = item.get("title", "").strip()

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
    ) -> FormQuestion | None:
        """
        Parse a single Forms API question dict into a FormQuestion.
        Returns None for question types we don't handle (e.g. FILE_UPLOAD).
        """
        # Determine question kind from which sub-key is present
        if "choiceQuestion" in question:
            return self._parse_choice(question_id, title, question["choiceQuestion"])
        if "textQuestion" in question:
            return self._parse_text(question_id, title, question["textQuestion"])
        if "scaleQuestion" in question:
            return self._parse_scale(question_id, title)
        if "dateQuestion" in question:
            return FormQuestion(question_id=question_id, title=title, nexus_type="string")
        if "timeQuestion" in question:
            return FormQuestion(question_id=question_id, title=title, nexus_type="string")
        if "gridQuestion" in question:
            return self._parse_grid(question_id, title, question["gridQuestion"])

        return None

    def _parse_choice(
        self,
        question_id: str,
        title: str,
        choice: dict,
    ) -> FormQuestion:
        """MULTIPLE_CHOICE (radio), CHECKBOX (multi), DROP_DOWN → choice options."""
        choice_type = choice.get("type", "MULTIPLE_CHOICE")

        # CHECKBOX → multi_select, everything else → string
        nexus_type = FORMS_TYPE_MAP.get(choice_type, "string")

        raw_options = [opt.get("value", "") for opt in choice.get("options", [])]
        options = [
            FormQuestionOption(raw=raw, alias=_suggest_alias(raw))
            for raw in raw_options
            if raw
        ]

        return FormQuestion(
            question_id=question_id,
            title=title,
            nexus_type=nexus_type,
            options=options,
        )

    def _parse_text(
        self,
        question_id: str,
        title: str,
        text: dict,
    ) -> FormQuestion:
        """Short answer or paragraph — always string."""
        return FormQuestion(question_id=question_id, title=title, nexus_type="string")

    def _parse_scale(self, question_id: str, title: str) -> FormQuestion:
        """Linear scale / rating — integer."""
        return FormQuestion(question_id=question_id, title=title, nexus_type="integer")

    def _parse_grid(
        self,
        question_id: str,
        title: str,
        grid: dict,
    ) -> FormQuestion:
        """
        Checkbox or radio grid — maps to multiple matrix_row columns in the sheet.
        Row labels are the time slots (or other row keys); column labels are the
        response options (e.g. "Available", "Maybe").
        """
        rows = [r.get("value", "") for r in grid.get("rows", []) if r.get("value")]
        columns_data = grid.get("columns", {})
        columns = [c.get("value", "") for c in columns_data.get("options", []) if c.get("value")]

        return FormQuestion(
            question_id=question_id,
            title=title,
            nexus_type="matrix_row",
            grid_rows=rows,
            grid_columns=columns,
        )