"""
Column mapping validation — run before saving a SheetConfig.

validate_column_mappings() returns a ValidationResult with structured
errors (block save) and warnings (informational). The caller decides
how to surface them.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class ValidationIssue:
    header: list[str] | str | None  # one or more column headers that triggered this issue
    message: str                    # human-readable description
    rule_index: int | None = None   # set if the issue is on a specific rule


@dataclass
class ValidationResult:
    errors: list[ValidationIssue] = field(default_factory=list)
    warnings: list[ValidationIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        """True if there are no hard errors (warnings are fine)."""
        return len(self.errors) == 0

    @staticmethod
    def _normalise_header(h: list[str] | str | None) -> list[str] | None:
        """Always return header as list[str] or None for consistent API shape."""
        if h is None:
            return None
        if isinstance(h, list):
            return h
        return [h]

    def _serialise_issues(self, issues: list[ValidationIssue]) -> list[dict]:
        return [
            {
                "header":     self._normalise_header(i.header),
                "rule_index": i.rule_index,
                "message":    i.message,
            }
            for i in issues
        ]

    def to_response_dict(self) -> dict:
        """
        Serialise for HTTP 422 error response bodies (raised when validation
        blocks a CREATE or PATCH). Shape: { ok, errors, warnings }.
        """
        return {
            "ok":   self.ok,
            "errors":   self._serialise_issues(self.errors),
            "warnings": self._serialise_issues(self.warnings),
        }


# Both the canonical action and its legacy alias are valid for parse_time_range.
# sync_service._apply_rules() accepts both.
PARSE_TIME_RANGE_ACTIONS = {"parse_time_range", "parse_availability"}


def validate_column_mappings(
    mappings: dict[str, dict],
) -> ValidationResult:
    """
    Validate a dict of {header: ColumnMapping-as-dict} entries.

    Checks are grouped into:
      - Config-level checks (across all mappings together)
      - Per-mapping checks
      - Per-rule checks (within each mapping's rules list)

    Returns a ValidationResult. Caller should check result.ok before saving.
    """
    result = ValidationResult()

    # ------------------------------------------------------------------
    # Config-level checks
    # ------------------------------------------------------------------

    # Email must be mapped
    email_mappings = [
        h for h, m in mappings.items()
        if m.get("field") == "email" and m.get("type") != "ignore"
    ]
    if not email_mappings:
        result.errors.append(ValidationIssue(
            header=None,
            message="No column is mapped to 'email'. Email is required as the upsert key.",
        ))
    elif len(email_mappings) > 1:
        result.errors.append(ValidationIssue(
            header=None,
            message=f"Multiple columns mapped to 'email': {email_mappings}. Only one is allowed.",
        ))

    # email field must be string type
    for header, mapping in mappings.items():
        if mapping.get("field") == "email" and mapping.get("type") not in ("string", "ignore"):
            result.errors.append(ValidationIssue(
                header=header,
                message="The 'email' field must use type 'string'.",
            ))

    # Duplicate extra_key values across all mappings — pass list directly
    extra_key_headers: dict[str, list[str]] = {}
    for header, mapping in mappings.items():
        if mapping.get("field") == "extra_data":
            ek = mapping.get("extra_key")
            if ek:
                extra_key_headers.setdefault(ek, []).append(header)
    for ek, headers in extra_key_headers.items():
        if len(headers) > 1:
            result.errors.append(ValidationIssue(
                header=headers,  # list[str] — frontend receives a proper array
                message=(
                    f"Duplicate extra_key '{ek}' across multiple columns. "
                    "Later columns will overwrite earlier ones during sync."
                ),
            ))

    # ------------------------------------------------------------------
    # Per-mapping checks
    # ------------------------------------------------------------------
    for header, mapping in mappings.items():
        field_name = mapping.get("field")
        field_type = mapping.get("type")
        rules: list[dict] = mapping.get("rules") or []

        # matrix_row requires row_key
        if field_type == "matrix_row" and not mapping.get("row_key"):
            result.errors.append(ValidationIssue(
                header=header,
                message="matrix_row type requires a row_key.",
            ))

        # extra_data requires extra_key
        if field_name == "extra_data" and not mapping.get("extra_key"):
            result.errors.append(ValidationIssue(
                header=header,
                message="Field 'extra_data' requires an extra_key.",
            ))

        # delimiter only valid on multi_select
        if mapping.get("delimiter") is not None and field_type != "multi_select":
            result.errors.append(ValidationIssue(
                header=header,
                message="'delimiter' is only valid for multi_select type.",
            ))

        # matrix_row mapped to availability with no parse_time_range rule (warning)
        # Accepts both the canonical action and its legacy alias.
        if field_type == "matrix_row" and field_name == "availability":
            has_parse_time_range = any(
                r.get("action") in PARSE_TIME_RANGE_ACTIONS for r in rules
            )
            if not has_parse_time_range:
                result.warnings.append(ValidationIssue(
                    header=header,
                    message=(
                        "This matrix_row is mapped to 'availability' but has no "
                        "'parse_time_range' rule. Availability data will not be parsed during sync."
                    ),
                ))

        # ------------------------------------------------------------------
        # Per-rule checks
        # ------------------------------------------------------------------
        set_fired_at: int | None = None  # track index of last set action

        for i, rule in enumerate(rules):
            condition = rule.get("condition", "")
            match_str = rule.get("match")
            action = rule.get("action", "")

            # parse_time_range (and legacy parse_availability) only valid on matrix_row
            if action in PARSE_TIME_RANGE_ACTIONS and field_type != "matrix_row":
                result.errors.append(ValidationIssue(
                    header=header,
                    rule_index=i,
                    message=f"'{action}' action is only valid on matrix_row fields.",
                ))

            # parse_time_range (and legacy parse_availability) must use condition "always"
            if action in PARSE_TIME_RANGE_ACTIONS and condition != "always":
                result.errors.append(ValidationIssue(
                    header=header,
                    rule_index=i,
                    message=f"'{action}' action requires condition 'always'.",
                ))

            # regex must compile
            if condition == "regex" and match_str:
                try:
                    re.compile(match_str)
                except re.error as e:
                    result.errors.append(ValidationIssue(
                        header=header,
                        rule_index=i,
                        message=f"Invalid regex pattern '{match_str}': {e}",
                    ))

            # match required for non-always conditions
            if condition != "always" and not match_str:
                result.errors.append(ValidationIssue(
                    header=header,
                    rule_index=i,
                    message=f"Rule condition '{condition}' requires a match value.",
                ))

            # value required for output actions
            if action in ("set", "replace", "prepend", "append") and rule.get("value") is None:
                result.errors.append(ValidationIssue(
                    header=header,
                    rule_index=i,
                    message=f"Rule action '{action}' requires a value.",
                ))

            # Warning: rule follows a "set" — operates on fixed value
            if set_fired_at is not None:
                result.warnings.append(ValidationIssue(
                    header=header,
                    rule_index=i,
                    message=(
                        f"Rule {i} follows a 'set' action at rule {set_fired_at}. "
                        "It will always operate on the fixed value produced by that rule, "
                        "which may be unintentional."
                    ),
                ))

            # Track set actions for the warning above
            if action == "set":
                set_fired_at = i

        # row_key time range parseable (warning only)
        if field_type == "matrix_row" and mapping.get("row_key"):
            row_key = mapping["row_key"]
            normalized = re.sub(r"\s+", " ", row_key.strip())
            parts = normalized.split(" - ", 1)
            if len(parts) != 2:
                result.warnings.append(ValidationIssue(
                    header=header,
                    message=(
                        f"row_key '{row_key}' does not appear to be a valid time range "
                        "(expected format: 'H:MM AM - H:MM PM'). "
                        "Availability parsing may fail during sync."
                    ),
                ))

    return result