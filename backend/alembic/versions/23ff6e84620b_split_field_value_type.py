"""split column mapping type into field_type + value_type

Revision ID: 23ff6e84620b
Revises: 2f2394fbbc02
Create Date: 2026-04-07 18:34:15.649967

Data migration for sheet_configs.column_mappings:

1. Translate old flat `type` field → field_type + value_type using the map below.
2. Rename row_key → group_key on any mapping entry that has it.
3. On any mapping entry with a rules list containing a rule where
   action == "parse_time_range" or action == "parse_availability":
     - Remove that rule from the list.
     - Set value_type = "time_range" on the mapping (overrides the default
       "text" from step 1 if needed).

Old type → (field_type, value_type):
  string       → single, text
  boolean      → single, boolean
  integer      → single, number
  multi_select → list,   text
  matrix_row   → group,  text
  ignore       → ignore, null

Legacy type aliases are also handled:
  availability_row → matrix_row → group, text
  category_events  → string    → single, text

This migration is irreversible. Take a backup before running.
"""
from __future__ import annotations

import json
from typing import Any, Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '23ff6e84620b'
down_revision: Union[str, None] = '2f2394fbbc02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ---------------------------------------------------------------------------
# Type coercion map
# ---------------------------------------------------------------------------

# Legacy type aliases → canonical old type
_LEGACY_TYPE_ALIASES: dict[str, str] = {
    "availability_row": "matrix_row",
    "category_events":  "string",
}

# Old type → (field_type, value_type | None)
_TYPE_TO_FIELD_VALUE: dict[str, tuple[str, str | None]] = {
    "string":       ("single", "text"),
    "boolean":      ("single", "boolean"),
    "integer":      ("single", "number"),
    "multi_select": ("list",   "text"),
    "matrix_row":   ("group",  "text"),
    "ignore":       ("ignore", None),
}

# Rule actions that expressed time_range coercion — now replaced by value_type
_TIME_RANGE_ACTIONS = {"parse_time_range", "parse_availability"}


# ---------------------------------------------------------------------------
# Per-entry migration helper
# ---------------------------------------------------------------------------

def _migrate_entry(entry: dict) -> tuple[dict, bool]:
    """
    Migrate a single column mapping entry in place.
    Returns (updated_entry, changed).
    """
    if not isinstance(entry, dict):
        return entry, False

    changed = False

    # 1. Translate old `type` → field_type + value_type
    if "type" in entry and "field_type" not in entry:
        old_type = str(entry.pop("type"))
        changed = True

        # Resolve legacy aliases first
        old_type = _LEGACY_TYPE_ALIASES.get(old_type, old_type)

        field_type, value_type = _TYPE_TO_FIELD_VALUE.get(old_type, ("single", "text"))
        entry["field_type"] = field_type
        if value_type is not None:
            entry.setdefault("value_type", value_type)
        # ignore has no value_type — remove if somehow set
        if field_type == "ignore":
            entry.pop("value_type", None)

    # 2. Rename row_key → group_key
    if "row_key" in entry and "group_key" not in entry:
        entry["group_key"] = entry.pop("row_key")
        changed = True

    # 3. Remove parse_time_range / parse_availability rules,
    #    set value_type = "time_range" if any were found.
    rules = entry.get("rules")
    if rules and isinstance(rules, list):
        new_rules = []
        found_time_range = False
        for rule in rules:
            if isinstance(rule, dict) and rule.get("action") in _TIME_RANGE_ACTIONS:
                found_time_range = True
                changed = True
                # Drop this rule — do not append
            else:
                new_rules.append(rule)
        if found_time_range:
            entry["rules"] = new_rules if new_rules else None
            if entry.get("rules") is None:
                entry.pop("rules", None)
            entry["value_type"] = "time_range"
        elif rules != new_rules:
            entry["rules"] = new_rules

    return entry, changed


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------

def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name  # "sqlite" or "postgresql"

    rows = bind.execute(
        sa.text("SELECT id, column_mappings FROM sheet_configs")
    ).fetchall()

    for row in rows:
        config_id: int = row[0]
        raw = row[1]

        if raw is None:
            continue

        # SQLite returns JSON columns as strings; PostgreSQL as native objects.
        mappings = json.loads(raw) if isinstance(raw, str) else raw

        if not isinstance(mappings, list):
            continue

        any_changed = False
        for i, entry in enumerate(mappings):
            updated, changed = _migrate_entry(entry)
            if changed:
                mappings[i] = updated
                any_changed = True

        if not any_changed:
            continue

        serialized = json.dumps(mappings)
        if dialect == "postgresql":
            bind.execute(
                sa.text(
                    "UPDATE sheet_configs"
                    " SET column_mappings = cast(:cm AS jsonb)"
                    " WHERE id = :id"
                ),
                {"cm": serialized, "id": config_id},
            )
        else:
            bind.execute(
                sa.text(
                    "UPDATE sheet_configs SET column_mappings = :cm WHERE id = :id"
                ),
                {"cm": serialized, "id": config_id},
            )


def downgrade() -> None:
    # Field type split is irreversible — downgrade is a no-op.
    pass