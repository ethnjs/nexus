"""
Sync service — reads rows from a Google Sheet and upserts Users + Memberships.

Flow per row:
  1. Apply parse rules to raw cell value (string transforms, in order)
  2. Type-coerce the result via value_type dispatch
  3. Upsert User by email
  4. Upsert Membership by (user_id, tournament_id)
  5. Return SyncResult summary
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.models import Event, Membership, SheetConfig, Tournament, User
from app.core.phone import format_phone_us
from app.schemas.sheet_config import (
    SyncError,
    SyncResult,
    coerce_legacy_mapping,
    normalize_column_mappings_input,
)
from app.services.sheets_service import SheetsService


# ---------------------------------------------------------------------------
# User fields — fields that map to User table columns
# ---------------------------------------------------------------------------
# Identity fields — always written to User
_USER_IDENTITY_FIELDS = frozenset({
    "first_name", "last_name", "email", "phone",
})

# TODO(temp): written to Membership until user self-management is implemented
_MEMBERSHIP_PROFILE_FIELDS = frozenset({
    "shirt_size", "dietary_restriction",
    "university", "major", "employer",
    "student_status", "competition_exp", "volunteering_exp",
})

# Union — all fields that come from VOLUNTEER_KNOWN_FIELDS user-side hints
_USER_FIELDS = _USER_IDENTITY_FIELDS | _MEMBERSHIP_PROFILE_FIELDS

# ---------------------------------------------------------------------------
# Name splitting
# ---------------------------------------------------------------------------

def _split_full_name(full_name: str) -> tuple[str, str]:
    """
    Split a full name into (first_name, last_name).

    Simple heuristic: everything before the last space is the first name,
    everything after is the last name. Handles single-word names by using
    the whole string as first_name with empty last_name.

    Examples:
        "Alice Smith"       → ("Alice", "Smith")
        "Mary Jane Watson"  → ("Mary Jane", "Watson")
        "Madonna"           → ("Madonna", "")
        "  Bob  Jones  "    → ("Bob", "Jones")
    """
    parts = full_name.strip().split()
    if not parts:
        return ("", "")
    if len(parts) == 1:
        return (parts[0], "")
    return (" ".join(parts[:-1]), parts[-1])


# ---------------------------------------------------------------------------
# Time parsing helpers
# ---------------------------------------------------------------------------

def _parse_time(raw: str) -> str:
    raw = raw.strip().upper()
    if raw in ("NOON", "12:00 PM", "12:00PM"):
        return "12:00"
    if raw == "MIDNIGHT":
        return "00:00"

    match = re.match(r"(\d{1,2}):(\d{2})\s*(AM|PM)", raw)
    if not match:
        raise ValueError(f"Cannot parse time: '{raw}'")

    h, m, period = int(match.group(1)), int(match.group(2)), match.group(3)
    if period == "AM":
        if h == 12:
            h = 0
    else:
        if h != 12:
            h += 12
    return f"{h:02d}:{m:02d}"


def _parse_time_range(group_key: str) -> tuple[str, str]:
    normalized = re.sub(r"\s+", " ", group_key.strip())
    parts = normalized.split(" - ", 1)
    if len(parts) != 2:
        raise ValueError(f"Cannot parse time range: '{group_key}'")
    return _parse_time(parts[0]), _parse_time(parts[1])


# ---------------------------------------------------------------------------
# Date parsing helpers
# ---------------------------------------------------------------------------

def _parse_day_string(day_str: str, tournament: Tournament) -> str | None:
    day_str = day_str.strip()

    date_match = re.search(r"(\d{1,2})/(\d{1,2})", day_str)
    month: int | None = None
    day: int | None = None
    if date_match:
        month = int(date_match.group(1))
        day = int(date_match.group(2))
    else:
        # Also accept month-name formats, e.g. "February 14" or "Feb 14".
        month_name_match = re.search(
            r"\b([A-Za-z]{3,9})\s+(\d{1,2})\b",
            day_str,
        )
        if month_name_match:
            month_word = month_name_match.group(1)
            day = int(month_name_match.group(2))
            for fmt in ("%B", "%b"):
                try:
                    month = datetime.strptime(month_word, fmt).month
                    break
                except ValueError:
                    continue

    if month is None or day is None:
        return None

    for block in (tournament.blocks or []):
        block_date_str = block.get("date", "")
        if not block_date_str:
            continue
        try:
            block_date = datetime.strptime(block_date_str, "%Y-%m-%d").date()
            if block_date.month == month and block_date.day == day:
                return block_date_str
        except ValueError:
            continue

    if tournament.start_date:
        year = tournament.start_date.year
        try:
            return f"{year}-{month:02d}-{day:02d}"
        except Exception:
            pass

    return None


# ---------------------------------------------------------------------------
# Availability parsing
# ---------------------------------------------------------------------------

def _parse_availability(
    cell_value: str,
    group_key: str,
    tournament: Tournament,
) -> list[dict]:
    if not cell_value or cell_value.strip().lower() == "none":
        return []

    start_time, end_time = _parse_time_range(group_key)
    slots = []

    for day_str in cell_value.split(","):
        date_str = _parse_day_string(day_str.strip(), tournament)
        if date_str:
            slots.append({"date": date_str, "start": start_time, "end": end_time})

    return slots


_TIME_TOKEN_RE = r"(?:NOON|MIDNIGHT|\d{1,2}:\d{2}\s*(?:AM|PM))"
_TIME_RANGE_RE = re.compile(
    rf"(?P<start>{_TIME_TOKEN_RE})\s*-\s*(?P<end>{_TIME_TOKEN_RE})",
    flags=re.IGNORECASE,
)


def _extract_group_key_and_day_text(value: str) -> tuple[str, str]:
    """
    Extract "start - end" and the remaining day text from a value string.

    Example:
        "February 14 7:00AM - 5:00PM" -> ("7:00AM - 5:00PM", "February 14")
    """
    m = _TIME_RANGE_RE.search(value or "")
    if not m:
        raise ValueError(f"Cannot parse time range from value: '{value}'")

    start = m.group("start")
    end = m.group("end")
    group_key = f"{start} - {end}"
    day_text = (value[:m.start()] + value[m.end():]).strip(" ,;-")
    return group_key, day_text


def _merge_availability(existing: list[dict], new_slots: list[dict]) -> list[dict]:
    all_slots = list(existing) + list(new_slots)

    by_date: dict[str, list[dict]] = {}
    for slot in all_slots:
        by_date.setdefault(slot["date"], []).append(slot)

    merged = []
    for date, slots in sorted(by_date.items()):
        slots.sort(key=lambda s: s["start"])
        current = dict(slots[0])
        for slot in slots[1:]:
            if slot["start"] <= current["end"]:
                if slot["end"] > current["end"]:
                    current["end"] = slot["end"]
            else:
                merged.append(current)
                current = dict(slot)
        merged.append(current)

    return merged


# ---------------------------------------------------------------------------
# Rule application
# ---------------------------------------------------------------------------

def _rule_matches(
    value: str,
    condition: str,
    match: str | None,
    case_sensitive: bool,
) -> bool:
    if condition == "always":
        return True
    if match is None:
        return False

    compare_value = value if case_sensitive else value.lower()
    compare_match = match if case_sensitive else match.lower()

    if condition == "contains":
        return compare_match in compare_value
    if condition == "equals":
        return compare_value == compare_match
    if condition == "starts_with":
        return compare_value.startswith(compare_match)
    if condition == "ends_with":
        return compare_value.endswith(compare_match)
    if condition == "regex":
        flags = 0 if case_sensitive else re.IGNORECASE
        return bool(re.search(match, value, flags))

    return False


def _apply_rules(
    value: str,
    rules: list[dict],
    mapping: dict,
    tournament: Tournament,
) -> str | None:
    """
    Apply an ordered list of parse rules to a raw cell string.

    Returns:
    - None — discard fired
    - str  — transformed string; value_type coercion runs next
    """
    current: str = value

    for rule in rules:
        condition = rule.get("condition", "always")
        match = rule.get("match")
        case_sensitive = rule.get("case_sensitive", False)
        action = rule.get("action")
        rule_value = rule.get("value", "")

        if not _rule_matches(current, condition, match, case_sensitive):
            continue

        if action == "discard":
            return None

        if action == "set":
            current = rule_value

        elif action == "replace":
            if condition == "regex" and match:
                flags = 0 if case_sensitive else re.IGNORECASE
                current = re.sub(match, rule_value, current, flags=flags)
            elif match:
                if not case_sensitive:
                    current = re.sub(
                        re.escape(match), rule_value, current, flags=re.IGNORECASE
                    )
                else:
                    current = current.replace(match, rule_value)

        elif action == "prepend":
            current = rule_value + current

        elif action == "append":
            current = current + rule_value

    return current


# ---------------------------------------------------------------------------
# Value type coercion
# ---------------------------------------------------------------------------

def _coerce_value(value: str, value_type: str | None, field: str | None) -> Any:
    """Coerce a post-rules string to the target value_type."""
    if value_type == "text" or value_type is None:
        parsed = value.strip() if value else None
        if parsed is None:
            return None
        if field == "phone":
            return format_phone_us(parsed)
        return parsed

    if value_type == "boolean":
        v = value.strip().lower()
        if v in ("yes", "true", "1"):
            return True
        if v in ("no", "false", "0"):
            return False
        return None

    if value_type == "number":
        try:
            stripped = value.strip()
            if "." in stripped:
                return float(stripped)
            return int(stripped)
        except (ValueError, AttributeError):
            return None

    if value_type == "date":
        stripped = value.strip() if value else None
        return stripped or None

    # time_range is handled at _process_cell level (needs group_key + tournament)
    return value.strip() if value else None


# ---------------------------------------------------------------------------
# Field processing helpers
# ---------------------------------------------------------------------------

def _split_multi_select_options(
    value: str,
    options: list[str],
    delimiter: str = ",",
) -> list[str]:
    """
    Greedily split a multi-select cell value against a known option list.

    Handles commas that appear inside option text by matching longest options
    first, so "Life, Personal & Social Science, Chemistry Lab" splits correctly
    when "Life, Personal & Social Science" is a known option.

    Falls back to delimiter split for any portion that doesn't match a known option.
    """
    result = []
    remaining = value.strip()
    sep = delimiter.strip()

    while remaining:
        matched = False
        for opt in options:
            opt_stripped = opt.strip()
            if remaining.startswith(opt_stripped):
                result.append(opt_stripped)
                remaining = remaining[len(opt_stripped):].lstrip()
                if remaining.startswith(sep):
                    remaining = remaining[len(sep):].lstrip()
                matched = True
                break
        if not matched:
            idx = remaining.find(sep)
            if idx == -1:
                result.append(remaining.strip())
                break
            result.append(remaining[:idx].strip())
            remaining = remaining[idx + len(sep):].lstrip()

    return [v for v in result if v]


# ---------------------------------------------------------------------------
# Field processing
# ---------------------------------------------------------------------------

def _process_cell(
    value: str,
    mapping: dict,
    tournament: Tournament,
) -> Any:
    # Coerce legacy type/row_key fields so old in-memory mappings still work
    mapping = coerce_legacy_mapping(mapping)

    field_type = mapping.get("field_type", "single")
    value_type = mapping.get("value_type")

    if field_type == "ignore":
        return None

    rules = mapping.get("rules") or []
    if rules:
        result = _apply_rules(value, rules, mapping, tournament)

        if result is None:
            return None

        value = result

    # value_type dispatch
    if value_type == "time_range":
        # Availability-style parsing: group_key is the time range string
        group_key = (mapping.get("group_key") or "").strip()
        day_value = value

        if not group_key:
            # Extract time range from the value itself when group_key absent
            group_key, day_value = _extract_group_key_and_day_text(value)

        return _parse_availability(day_value, group_key, tournament)

    if field_type == "list":
        if not value or not value.strip():
            return []
        delimiter = mapping.get("delimiter") or ","
        options = mapping.get("options")
        if options:
            rules_list = mapping.get("rules") or []
            alias_map = {
                r["match"]: r["value"]
                for r in rules_list
                if r.get("is_alias") and r.get("match") and r.get("value")
            }
            alias_options = sorted(
                [alias_map.get(o, o) for o in options],
                key=len,
                reverse=True,
            )
            parts = _split_multi_select_options(value, alias_options, delimiter)
        else:
            parts = [v.strip() for v in value.split(delimiter) if v.strip()]

        if value_type and value_type != "text":
            return [_coerce_value(p, value_type, mapping.get("field")) for p in parts]
        return parts

    if field_type == "group":
        # Returns the coerced scalar; caller aggregates into a dict keyed by group_key
        return _coerce_value(value, value_type, mapping.get("field"))

    # field_type == "single"
    return _coerce_value(value, value_type, mapping.get("field"))


# ---------------------------------------------------------------------------
# Main sync function
# ---------------------------------------------------------------------------

def sync_sheet(
    config: SheetConfig,
    db: Session,
    sheets_svc: SheetsService,
) -> SyncResult:
    tournament = db.query(Tournament).filter(
        Tournament.id == config.tournament_id
    ).first()
    if not tournament:
        raise ValueError(f"Tournament {config.tournament_id} not found")

    # Canonical mapping shape is list entries with (column_index, header, mapping...).
    mappings: list[dict[str, Any]] = normalize_column_mappings_input(config.column_mappings or [])

    headers: list[str] = []
    rows: list[list[str]] = []
    try:
        headers, rows = sheets_svc.get_rows_with_headers(config.spreadsheet_id, config.sheet_name)
    except Exception:
        # Backwards-compat fallback for older mocks/services that only expose get_rows().
        legacy_rows = sheets_svc.get_rows(config.spreadsheet_id, config.sheet_name)
        if legacy_rows and isinstance(legacy_rows[0], dict):
            headers = [str(m.get("header", "")) for m in mappings]
            rows = [
                [str(r.get(h, "")) for h in headers]
                for r in legacy_rows
            ]
        else:
            headers = []
            rows = []

    created = updated = skipped = 0
    errors: list[SyncError] = []

    for row_index, row in enumerate(rows, start=2):
        email = None
        try:
            user_fields: dict[str, Any] = {}
            membership_fields: dict[str, Any] = {}
            availability_slots: list[dict] = []
            extra_data: dict[str, Any] = {}
            event_pref_ranked: dict[str, str] = {}  # group_key → cell value for grid ranking

            for mapping in mappings:
                header = str(mapping.get("header", ""))
                col_idx = int(mapping.get("column_index", -1))
                if col_idx < 0:
                    continue

                raw_value = row[col_idx] if col_idx < len(row) else ""

                field = mapping.get("field")

                # Coerce legacy type/row_key before dispatch
                m = coerce_legacy_mapping(mapping)
                field_type = m.get("field_type", "single")

                if field_type == "ignore" or field == "__ignore__":
                    continue

                processed = _process_cell(raw_value, mapping, tournament)

                if field == "full_name":
                    # Split full name into first_name + last_name
                    if processed and isinstance(processed, str):
                        first, last = _split_full_name(processed)
                        if first:
                            user_fields["first_name"] = first
                        if last:
                            user_fields["last_name"] = last

                elif field == "availability":
                    if processed and isinstance(processed, list):
                        availability_slots.extend(processed)

                elif field == "event_preference":
                    if field_type == "group":
                        # Grid-ranked event preference: group_key is the event name,
                        # cell value is the rank (e.g. "1st choice", "2nd choice")
                        group_key = m.get("group_key", "")
                        if processed and group_key:
                            event_pref_ranked[group_key] = str(processed)
                    elif processed is not None:
                        if isinstance(processed, str):
                            processed = [processed]
                        membership_fields.setdefault("event_preference", [])
                        membership_fields["event_preference"].extend(
                            processed if isinstance(processed, list) else [processed]
                        )

                elif field == "extra_data" and field_type == "group":
                    # group aggregation into extra_data.
                    # When extra_key is set, nest under extra_data[extra_key][group_key].
                    # Without extra_key, store flat at extra_data[group_key].
                    group_key = (m.get("group_key") or "").strip() or _slug(header)
                    extra_key = (m.get("extra_key") or "").strip()
                    if extra_key:
                        if not isinstance(extra_data.get(extra_key), dict):
                            extra_data[extra_key] = {}
                        extra_data[extra_key][group_key] = processed if processed is not None else ""
                    else:
                        extra_data[group_key] = processed if processed is not None else ""

                elif field_type == "group" and field not in ("availability", "event_preference"):
                    # Generic group aggregation: build a dict keyed by group_key.
                    # Blank cells store "" so all keys are always present.
                    group_key = (m.get("group_key") or "").strip()
                    if not group_key:
                        group_key = _slug(header)
                    if field not in membership_fields:
                        membership_fields[field] = {}
                    membership_fields[field][group_key] = processed if processed is not None else ""

                elif field == "extra_data":
                    extra_key = m.get("extra_key")
                    if extra_key and processed is not None:
                        extra_data[extra_key] = processed

                elif field in _USER_IDENTITY_FIELDS:
                    if processed is not None:
                        user_fields[field] = processed

                # TODO(temp): sync profile fields to membership instead of user
                elif field in _MEMBERSHIP_PROFILE_FIELDS:
                    if processed is not None:
                        membership_fields[field] = processed

                else:
                    if processed is not None:
                        if field == "role_preference" and isinstance(processed, str):
                            processed = [processed]
                        membership_fields[field] = processed

            # Resolve grid-ranked event preferences into an ordered list
            if event_pref_ranked:
                ranked_list = _resolve_ranked_preferences(event_pref_ranked)
                existing = membership_fields.get("event_preference", [])
                membership_fields["event_preference"] = ranked_list + existing

            email = user_fields.get("email")
            if not email:
                errors.append(SyncError(
                    row=row_index, email=None, detail="Missing email address"
                ))
                skipped += 1
                continue

            user = db.query(User).filter(User.email == email).first()
            if user:
                for k, v in user_fields.items():
                    setattr(user, k, v)
                db.flush()
            else:
                if not user_fields.get("first_name") or not user_fields.get("last_name"):
                    errors.append(SyncError(
                        row=row_index,
                        email=email,
                        detail="Missing first_name or last_name",
                    ))
                    skipped += 1
                    continue
                user = User(**user_fields)
                db.add(user)
                db.flush()

            membership = db.query(Membership).filter(
                Membership.user_id == user.id,
                Membership.tournament_id == tournament.id,
            ).first()

            merged_availability = _merge_availability([], availability_slots)

            if membership:
                for k, v in membership_fields.items():
                    setattr(membership, k, v)
                membership.availability = merged_availability
                existing_extra = dict(membership.extra_data or {})
                existing_extra.update(extra_data)
                membership.extra_data = existing_extra
                updated += 1
            else:
                membership = Membership(
                    user_id=user.id,
                    tournament_id=tournament.id,
                    status="interested",
                    availability=merged_availability,
                    extra_data=extra_data or None,
                    **membership_fields,
                )
                db.add(membership)
                created += 1

        except Exception as e:
            db.rollback()
            errors.append(SyncError(
                row=row_index,
                email=email,
                detail=str(e),
            ))
            skipped += 1
            continue

    try:
        now = datetime.now(timezone.utc)
        config.last_synced_at = now
        db.commit()
    except Exception as e:
        db.rollback()
        raise RuntimeError(f"Failed to commit sync: {e}") from e

    return SyncResult(
        created=created,
        updated=updated,
        skipped=skipped,
        errors=errors,
        last_synced_at=now,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _slug(text: str) -> str:
    """Slugify a header string for use as a fallback group_key."""
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:50]


# Ranked-preference column ordering
# Maps common ranking labels to sort order. Lower = higher priority.
_RANK_ORDER: dict[str, int] = {
    "1st choice": 1,
    "1st": 1,
    "first choice": 1,
    "2nd choice": 2,
    "2nd": 2,
    "second choice": 2,
    "3rd choice": 3,
    "3rd": 3,
    "third choice": 3,
    "4th choice": 4,
    "4th": 4,
    "5th choice": 5,
    "5th": 5,
}


def _rank_sort_key(rank_value: str) -> int:
    """
    Convert a rank label to a sort-order int.
    Falls back to parsing leading digits, then 999 for unknowns.
    """
    lower = rank_value.strip().lower()
    if lower in _RANK_ORDER:
        return _RANK_ORDER[lower]
    # Try parsing leading digit: "1st choice" variants
    m = re.match(r"(\d+)", lower)
    if m:
        return int(m.group(1))
    return 999


def _resolve_ranked_preferences(ranked: dict[str, str]) -> list[str]:
    """
    Convert a {event_name: rank_label} dict into an ordered list of event names.

    The rank_label is the grid column value (e.g. "1st choice", "2nd choice").
    Events are sorted by rank. Events without a parseable rank go at the end.

    Example:
        {"Anatomy": "2nd choice", "Forensics": "1st choice", "Chem Lab": "3rd choice"}
        → ["Forensics", "Anatomy", "Chem Lab"]
    """
    items = [(event, _rank_sort_key(rank)) for event, rank in ranked.items()]
    items.sort(key=lambda x: x[1])
    return [event for event, _ in items]
