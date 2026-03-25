"""
Sync service — reads rows from a Google Sheet and upserts Users + Memberships.

Flow per row:
  1. Parse all columns using their ColumnMapping type
  2. Upsert User by email
  3. Upsert Membership by (user_id, tournament_id)
  4. Return SyncResult summary
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.models import Event, Membership, SheetConfig, Tournament, User
from app.schemas.sheet_config import SyncError, SyncResult, coerce_legacy_type
from app.services.sheets_service import SheetsService


# ---------------------------------------------------------------------------
# Time parsing helpers
# ---------------------------------------------------------------------------

def _parse_time(raw: str) -> str:
    """
    Convert human-readable time to HH:MM 24hr format.
    Handles: "8:00 AM", "10:00 AM", "NOON", "12:00 PM", "2:00 PM"
    """
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
    else:  # PM
        if h != 12:
            h += 12
    return f"{h:02d}:{m:02d}"


def _parse_time_range(row_key: str) -> tuple[str, str]:
    """
    Parse row_key like "8:00 AM - 10:00 AM" or "NOON - 2:00 PM".
    Normalizes extra whitespace around the dash first.
    Returns ("08:00", "10:00").
    """
    # Normalize multiple spaces to single space, then split on " - "
    normalized = re.sub(r"\s+", " ", row_key.strip())
    parts = normalized.split(" - ", 1)
    if len(parts) != 2:
        raise ValueError(f"Cannot parse time range: '{row_key}'")
    return _parse_time(parts[0]), _parse_time(parts[1])


# ---------------------------------------------------------------------------
# Date parsing helpers
# ---------------------------------------------------------------------------

def _parse_day_string(day_str: str, tournament: Tournament) -> str | None:
    """
    Convert a day string like "Thursday 5/21" or "Saturday 5/23" to a
    YYYY-MM-DD date string by cross-referencing tournament blocks.

    Strategy:
    - Extract M/DD from the string (e.g. "5/21")
    - Find a block whose date matches that month/day
    - Use the block's full date (which includes the year)
    - Falls back to start_date year if no block matches
    """
    day_str = day_str.strip()

    # Extract M/DD pattern
    date_match = re.search(r"(\d{1,2})/(\d{1,2})", day_str)
    if not date_match:
        return None

    month = int(date_match.group(1))
    day = int(date_match.group(2))

    # Try to find a matching block date
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

    # Fallback: use tournament start_date year with parsed month/day
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
    row_key: str,
    tournament: Tournament,
) -> list[dict]:
    """
    Parse one matrix row cell into availability slots.

    cell_value: "Thursday 5/21, Saturday 5/23" or "None"
    row_key:    "8:00 AM - 10:00 AM"

    Returns list of {date, start, end} dicts.
    Returns [] if cell is "None" or empty.
    """
    if not cell_value or cell_value.strip().lower() == "none":
        return []

    start_time, end_time = _parse_time_range(row_key)
    slots = []

    for day_str in cell_value.split(","):
        date_str = _parse_day_string(day_str.strip(), tournament)
        if date_str:
            slots.append({"date": date_str, "start": start_time, "end": end_time})

    return slots


def _merge_availability(existing: list[dict], new_slots: list[dict]) -> list[dict]:
    """
    Merge new slots into existing availability list.
    Consecutive slots on the same date are merged if they are contiguous.

    e.g. {date: X, start: 08:00, end: 10:00} + {date: X, start: 10:00, end: 12:00}
         → {date: X, start: 08:00, end: 12:00}
    """
    all_slots = list(existing) + list(new_slots)

    # Group by date
    by_date: dict[str, list[dict]] = {}
    for slot in all_slots:
        by_date.setdefault(slot["date"], []).append(slot)

    merged = []
    for date, slots in sorted(by_date.items()):
        # Sort by start time
        slots.sort(key=lambda s: s["start"])
        current = dict(slots[0])
        for slot in slots[1:]:
            if slot["start"] <= current["end"]:
                # Contiguous or overlapping — extend end if needed
                if slot["end"] > current["end"]:
                    current["end"] = slot["end"]
            else:
                merged.append(current)
                current = dict(slot)
        merged.append(current)

    return merged


# ---------------------------------------------------------------------------
# Field processing
# ---------------------------------------------------------------------------

def _process_cell(
    value: str,
    mapping: dict,
    tournament: Tournament,
) -> Any:
    """
    Process a single cell value according to its ColumnMapping type.
    Returns the processed value, or raises ValueError on bad input.
    """
    # Coerce any legacy type names before processing
    field_type = coerce_legacy_type(mapping.get("type", "string"))

    if field_type == "ignore":
        return None

    if field_type == "string":
        return value.strip() if value else None

    if field_type == "boolean":
        v = value.strip().lower()
        if v in ("yes", "true", "1"):
            return True
        if v in ("no", "false", "0"):
            return False
        return None

    if field_type == "integer":
        try:
            return int(value.strip())
        except (ValueError, AttributeError):
            return None

    if field_type == "multi_select":
        if not value or not value.strip():
            return []
        return [v.strip() for v in value.split(",") if v.strip()]

    if field_type == "matrix_row":
        row_key = mapping.get("row_key", "")
        return _parse_availability(value, row_key, tournament)

    # Unknown type — fall back to raw string rather than crashing
    return value.strip() if value else None


# ---------------------------------------------------------------------------
# Main sync function
# ---------------------------------------------------------------------------

def sync_sheet(
    config: SheetConfig,
    db: Session,
    sheets_svc: SheetsService,
) -> SyncResult:
    """
    Sync all rows from a sheet config into Users + Memberships.
    Performs a full upsert — existing records are updated.
    """
    tournament = db.query(Tournament).filter(
        Tournament.id == config.tournament_id
    ).first()
    if not tournament:
        raise ValueError(f"Tournament {config.tournament_id} not found")

    # Fetch all rows from the sheet
    rows = sheets_svc.get_rows(config.spreadsheet_id, config.sheet_name)

    created = updated = skipped = 0
    errors: list[SyncError] = []

    for row_index, row in enumerate(rows, start=2):  # row 1 is header
        email = None
        try:
            # ----------------------------------------------------------------
            # Step 1 — Parse all columns
            # ----------------------------------------------------------------
            user_fields: dict[str, Any] = {}
            membership_fields: dict[str, Any] = {}
            availability_slots: list[dict] = []
            extra_data: dict[str, Any] = {}

            mappings: dict = config.column_mappings or {}

            for header, raw_value in row.items():
                mapping = mappings.get(header)
                if not mapping:
                    continue

                field = mapping.get("field")
                field_type = coerce_legacy_type(mapping.get("type", "string"))

                if field_type == "ignore" or field == "__ignore__":
                    continue

                processed = _process_cell(raw_value, mapping, tournament)

                if field == "availability":
                    # Accumulate slots across all matrix rows
                    if processed:
                        availability_slots.extend(processed)

                elif field == "extra_data":
                    extra_key = mapping.get("extra_key")
                    if extra_key and processed is not None:
                        extra_data[extra_key] = processed

                elif field in ("first_name", "last_name", "email", "phone",
                               "shirt_size", "dietary_restriction",
                               "university", "major", "employer"):
                    if processed is not None:
                        user_fields[field] = processed

                else:
                    # Membership fields
                    if processed is not None:
                        # event_preference is list[str] in the schema — if the column
                        # is typed as string (not multi_select), wrap it in a list so
                        # the response serializer doesn't reject it
                        if field == "event_preference" and isinstance(processed, str):
                            processed = [processed]
                        membership_fields[field] = processed

            # Email is required
            email = user_fields.get("email")
            if not email:
                errors.append(SyncError(
                    row=row_index, email=None, detail="Missing email address"
                ))
                skipped += 1
                continue

            # ----------------------------------------------------------------
            # Step 2 — Upsert User
            # ----------------------------------------------------------------
            user = db.query(User).filter(User.email == email).first()
            if user:
                for k, v in user_fields.items():
                    setattr(user, k, v)
                db.flush()
            else:
                # Ensure required fields present
                if not user_fields.get("first_name") or not user_fields.get("last_name"):
                    errors.append(SyncError(
                        row=row_index,
                        email=email,
                        detail="Missing first_name or last_name"
                    ))
                    skipped += 1
                    continue
                user = User(**user_fields)
                db.add(user)
                db.flush()  # get user.id

            # ----------------------------------------------------------------
            # Step 3 — Upsert Membership
            # ----------------------------------------------------------------
            membership = db.query(Membership).filter(
                Membership.user_id == user.id,
                Membership.tournament_id == tournament.id,
            ).first()

            # Merge availability slots (consecutive slots on same date get merged)
            merged_availability = _merge_availability([], availability_slots)

            if membership:
                # Overwrite membership fields from this sync
                for k, v in membership_fields.items():
                    setattr(membership, k, v)
                membership.availability = merged_availability
                # Merge extra_data
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

    # Commit all successful rows together
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