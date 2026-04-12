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

from app.schemas.sheet_config import coerce_legacy_mapping, VALID_RULE_ACTIONS, VALID_RULE_CONDITIONS


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


# Removed rule actions that are no longer valid (parse_time_range / parse_availability).
# These were previously used for availability coercion; time_range coercion is now
# expressed via value_type="time_range" on the mapping, not via a rule action.
_REMOVED_RULE_ACTIONS = {"parse_time_range", "parse_availability"}


def _normalise_mapping_entries(
    mappings: list[dict[str, Any]] | dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    if isinstance(mappings, dict):
        out: list[dict[str, Any]] = []
        for idx, (header, mapping) in enumerate(mappings.items()):
            entry = coerce_legacy_mapping(dict(mapping))
            out.append({
                "column_index": idx,
                "header": header,
                **entry,
            })
        return out

    out: list[dict[str, Any]] = []
    for idx, entry in enumerate(mappings):
        d = coerce_legacy_mapping(dict(entry))
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

    # Email must be mapped exactly once (field_type != "ignore")
    email_mappings = [
        (e.get("header"), int(e.get("column_index", -1)))
        for e in entries
        if e.get("field") == "email" and e.get("field_type") != "ignore"
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

    # email field must be single/text type
    for entry in entries:
        if (
            entry.get("field") == "email"
            and entry.get("field_type") not in ("single", "ignore")
        ):
            result.errors.append(ValidationIssue(
                header=entry.get("header"),
                column_index=entry.get("column_index"),
                message="The 'email' field must use field_type 'single' with value_type 'text'.",
            ))
        elif (
            entry.get("field") == "email"
            and entry.get("field_type") == "single"
            and entry.get("value_type") not in ("text", None)
        ):
            result.errors.append(ValidationIssue(
                header=entry.get("header"),
                column_index=entry.get("column_index"),
                message="The 'email' field must use field_type 'single' with value_type 'text'.",
            ))

    # Duplicate extra_key values across non-group extra_data mappings.
    # group entries aggregate into a JSON structure keyed by group_key, so
    # sharing an extra_key does not cause overwrites — skip them here.
    extra_key_headers: dict[str, list[str]] = {}
    extra_key_indices: dict[str, list[int]] = {}
    for entry in entries:
        if entry.get("field") == "extra_data" and entry.get("field_type") != "group":
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

    # Duplicate group_key within the same field for group mappings.
    # Two group columns with the same field AND group_key DO overwrite each other.
    # Key: (field, group_key) → list of headers / indices
    group_key_headers: dict[tuple[str, str], list[str]] = {}
    group_key_indices: dict[tuple[str, str], list[int]] = {}
    for entry in entries:
        if entry.get("field_type") == "group":
            field_name = entry.get("field") or ""
            gk = entry.get("group_key") or ""
            if field_name and gk:
                key = (field_name, gk)
                header = entry.get("header")
                if header is not None:
                    group_key_headers.setdefault(key, []).append(header)
                group_key_indices.setdefault(key, []).append(int(entry.get("column_index", -1)))

    for (field_name, gk), headers in group_key_headers.items():
        if len(headers) > 1:
            result.errors.append(ValidationIssue(
                header=headers,
                column_index=group_key_indices.get((field_name, gk)),
                message=(
                    f"Duplicate group_key '{gk}' for field '{field_name}' across multiple columns. "
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
        field_type = entry.get("field_type")
        value_type = entry.get("value_type")
        rules: list[dict] = entry.get("rules") or []

        # group requires group_key
        if field_type == "group" and not entry.get("group_key"):
            result.errors.append(ValidationIssue(
                header=header,
                column_index=col_idx,
                message="field_type 'group' requires a group_key.",
            ))

        # ignore type must map to __ignore__
        if field_type == "ignore" and field_name != "__ignore__":
            result.errors.append(ValidationIssue(
                header=header,
                column_index=col_idx,
                message="field_type 'ignore' requires field '__ignore__'.",
            ))

        # extra_data requires extra_key (unless it's a group — group_key serves as key)
        if field_name == "extra_data" and field_type != "group" and not entry.get("extra_key"):
            result.errors.append(ValidationIssue(
                header=header,
                column_index=col_idx,
                message="Field 'extra_data' requires an extra_key.",
            ))

        # delimiter only valid on list field_type
        if entry.get("delimiter") is not None and field_type != "list":
            result.errors.append(ValidationIssue(
                header=header,
                column_index=col_idx,
                message="'delimiter' is only valid for field_type 'list'.",
            ))

        # availability with value_type != "time_range" is a warning
        if field_name == "availability" and field_type == "group" and value_type != "time_range":
            result.warnings.append(ValidationIssue(
                header=header,
                column_index=col_idx,
                message=(
                    "This column is mapped to 'availability' with field_type 'group' but "
                    "value_type is not 'time_range'. Availability data will not be parsed during sync."
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

            # Removed actions (parse_time_range / parse_availability) are errors
            if action in _REMOVED_RULE_ACTIONS:
                result.errors.append(ValidationIssue(
                    header=header,
                    column_index=col_idx,
                    rule_index=i,
                    message=(
                        f"Rule action '{action}' is no longer valid. "
                        "Use value_type='time_range' on the mapping instead."
                    ),
                ))
            elif action not in VALID_RULE_ACTIONS:
                result.errors.append(ValidationIssue(
                    header=header,
                    column_index=col_idx,
                    rule_index=i,
                    message=f"Unknown rule action '{action}'. Must be one of: {sorted(VALID_RULE_ACTIONS)}.",
                ))

            if condition not in VALID_RULE_CONDITIONS:
                result.errors.append(ValidationIssue(
                    header=header,
                    column_index=col_idx,
                    rule_index=i,
                    message=f"Unknown rule condition '{condition}'. Must be one of: {sorted(VALID_RULE_CONDITIONS)}.",
                ))

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

        # availability group_key should be parseable as a time range (warning only)
        if field_name == "availability" and field_type == "group" and entry.get("group_key"):
            group_key = entry["group_key"]
            normalized = re.sub(r"\s+", " ", group_key.strip())
            parts = normalized.split(" - ", 1)
            if len(parts) != 2:
                result.warnings.append(ValidationIssue(
                    header=header,
                    column_index=col_idx,
                    message=(
                        f"group_key '{group_key}' does not appear to be a valid time range "
                        "(expected format: 'H:MM AM - H:MM PM'). "
                        "Availability parsing may fail during sync."
                    ),
                ))

    return result
