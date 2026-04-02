"""
Column mapping validation — run before saving a SheetConfig.

validate_column_mappings() returns a ValidationResult with structured
errors (block save) and warnings (informational). The caller decides
how to surface them.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ValidationIssue:
    header: list[str] | str | None                  # one or more column headers that triggered this issue
    message: str                                     # human-readable description
    column_index: list[int] | int | None = None     # stable column identity for duplicate-header sheets
    rule_index: int | None = None                   # set if the issue is on a specific rule


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
                "header": self._normalise_header(i.header),
                "column_index": i.column_index,
                "rule_index": i.rule_index,
                "message": i.message,
            }
            for i in issues
        ]

    def to_response_dict(self) -> dict:
        """
        Serialise for HTTP 422 error response bodies (raised when validation
        blocks a CREATE or PATCH). Shape: { ok, errors, warnings }.
        """
        return {
            "ok": self.ok,
            "errors": self._serialise_issues(self.errors),
            "warnings": self._serialise_issues(self.warnings),
        }


# Both the canonical action and its legacy alias are valid for parse_time_range.
# sync_service._apply_rules() accepts both.
PARSE_TIME_RANGE_ACTIONS = {"parse_time_range", "parse_availability"}


def _normalise_mapping_entries(
    mappings: list[dict[str, Any]] | dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    if isinstance(mappings, dict):
        out: list[dict[str, Any]] = []
        for idx, (header, mapping) in enumerate(mappings.items()):
            out.append({
                "column_index": idx,
                "header": header,
                **dict(mapping),
            })
        return out

    out: list[dict[str, Any]] = []
    for idx, entry in enumerate(mappings):
        d = dict(entry)
        out.append({
            "column_index": d.get("column_index", idx),
            "header": d.get("header"),
            **{k: v for k, v in d.items() if k not in ("column_index", "header")},
        })
    return out


def validate_column_mappings(
    mappings: list[dict[str, Any]] | dict[str, dict[str, Any]],
) -> ValidationResult:
    """
    Validate column mappings in either legacy-dict or canonical list-entry shape.

    Checks are grouped into:
      - Config-level checks (across all mappings together)
      - Per-mapping checks
      - Per-rule checks (within each mapping's rules list)
    """
    result = ValidationResult()
    entries = _normalise_mapping_entries(mappings)

    # ------------------------------------------------------------------
    # Config-level checks
    # ------------------------------------------------------------------

    # Email must be mapped exactly once
    email_mappings = [
        (e.get("header"), int(e.get("column_index", -1)))
        for e in entries
        if e.get("field") == "email" and e.get("type") != "ignore"
    ]
    if not email_mappings:
        result.errors.append(ValidationIssue(
            header=None,
            column_index=None,
            message="No column is mapped to 'email'. Email is required as the upsert key.",
        ))
    elif len(email_mappings) > 1:
        labels = [f"{h} [#{i}]" for h, i in email_mappings]
        result.errors.append(ValidationIssue(
            header=[h for h, _ in email_mappings],
            column_index=[i for _, i in email_mappings],
            message=f"Multiple columns mapped to 'email': {labels}. Only one is allowed.",
        ))

    # email field must be string type
    for entry in entries:
        if entry.get("field") == "email" and entry.get("type") not in ("string", "ignore"):
            result.errors.append(ValidationIssue(
                header=entry.get("header"),
                column_index=entry.get("column_index"),
                message="The 'email' field must use type 'string'.",
            ))

    # Duplicate extra_key values across all mappings
    extra_key_headers: dict[str, list[str]] = {}
    extra_key_indices: dict[str, list[int]] = {}
    for entry in entries:
        if entry.get("field") == "extra_data":
            ek = entry.get("extra_key")
            if ek:
                header = entry.get("header")
                if header is not None:
                    extra_key_headers.setdefault(ek, []).append(header)
                extra_key_indices.setdefault(ek, []).append(int(entry.get("column_index", -1)))

    for ek, headers in extra_key_headers.items():
        if len(headers) > 1:
            result.errors.append(ValidationIssue(
                header=headers,
                column_index=extra_key_indices.get(ek),
                message=(
                    f"Duplicate extra_key '{ek}' across multiple columns. "
                    "Later columns will overwrite earlier ones during sync."
                ),
            ))

    # ------------------------------------------------------------------
    # Per-mapping checks
    # ------------------------------------------------------------------
    for entry in entries:
        header = entry.get("header")
        col_idx = entry.get("column_index")
        field_name = entry.get("field")
        field_type = entry.get("type")
        rules: list[dict] = entry.get("rules") or []

        # matrix_row requires row_key
        if field_type == "matrix_row" and not entry.get("row_key"):
            result.errors.append(ValidationIssue(
                header=header,
                column_index=col_idx,
                message="matrix_row type requires a row_key.",
            ))

        # ignore type must map to __ignore__
        if field_type == "ignore" and field_name != "__ignore__":
            result.errors.append(ValidationIssue(
                header=header,
                column_index=col_idx,
                message="type 'ignore' requires field '__ignore__'.",
            ))

        # extra_data requires extra_key
        if field_name == "extra_data" and not entry.get("extra_key"):
            result.errors.append(ValidationIssue(
                header=header,
                column_index=col_idx,
                message="Field 'extra_data' requires an extra_key.",
            ))

        # delimiter only valid on multi_select
        if entry.get("delimiter") is not None and field_type != "multi_select":
            result.errors.append(ValidationIssue(
                header=header,
                column_index=col_idx,
                message="'delimiter' is only valid for multi_select type.",
            ))

        # availability mappings should include parse_time_range rule (warning only)
        if field_name == "availability":
            has_parse_time_range = any(r.get("action") in PARSE_TIME_RANGE_ACTIONS for r in rules)
            if not has_parse_time_range:
                result.warnings.append(ValidationIssue(
                    header=header,
                    column_index=col_idx,
                    message=(
                        "This column is mapped to 'availability' but has no "
                        "'parse_time_range' rule. Availability data will not be parsed during sync."
                    ),
                ))

        # ------------------------------------------------------------------
        # Per-rule checks
        # ------------------------------------------------------------------
        set_fired_at: int | None = None
        for i, rule in enumerate(rules):
            condition = rule.get("condition", "")
            match_str = rule.get("match")
            action = rule.get("action", "")

            # regex must compile
            if condition == "regex" and match_str:
                try:
                    re.compile(match_str)
                except re.error as e:
                    result.errors.append(ValidationIssue(
                        header=header,
                        column_index=col_idx,
                        rule_index=i,
                        message=f"Invalid regex pattern '{match_str}': {e}",
                    ))

            # match required for non-always conditions
            if condition != "always" and not match_str:
                result.errors.append(ValidationIssue(
                    header=header,
                    column_index=col_idx,
                    rule_index=i,
                    message=f"Rule condition '{condition}' requires a match value.",
                ))

            # value required for output actions
            if action in ("set", "replace", "prepend", "append") and rule.get("value") is None:
                result.errors.append(ValidationIssue(
                    header=header,
                    column_index=col_idx,
                    rule_index=i,
                    message=f"Rule action '{action}' requires a value.",
                ))

            # Warning: rule follows a "set" — operates on fixed value
            if set_fired_at is not None:
                result.warnings.append(ValidationIssue(
                    header=header,
                    column_index=col_idx,
                    rule_index=i,
                    message=(
                        f"Rule {i} follows a 'set' action at rule {set_fired_at}. "
                        "It will always operate on the fixed value produced by that rule, "
                        "which may be unintentional."
                    ),
                ))

            if action == "set":
                set_fired_at = i

        # availability row_key should be parseable as a time range (warning only)
        if field_name == "availability" and entry.get("row_key"):
            row_key = entry["row_key"]
            normalized = re.sub(r"\s+", " ", row_key.strip())
            parts = normalized.split(" - ", 1)
            if len(parts) != 2:
                result.warnings.append(ValidationIssue(
                    header=header,
                    column_index=col_idx,
                    message=(
                        f"row_key '{row_key}' does not appear to be a valid time range "
                        "(expected format: 'H:MM AM - H:MM PM'). "
                        "Availability parsing may fail during sync."
                    ),
                ))

    return result
