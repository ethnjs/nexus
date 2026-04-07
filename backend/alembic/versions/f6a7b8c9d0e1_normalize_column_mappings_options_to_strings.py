"""normalize column_mappings options to list[str]

Revision ID: f6a7b8c9d0e1
Revises: ffc1c5a0d62f
Create Date: 2026-04-02

Data migration for sheet_configs.column_mappings:

1. Shape normalisation — legacy dict shape {header: {field, type, ...}} is
   converted to the canonical list shape [{column_index, header, ...}],
   assigning column_index by iteration order.

2. Options normalisation — options stored as [{raw, alias}] objects are
   flattened to plain raw strings. Entries already stored as strings are
   left as-is.

3. is_alias tagging — for each rule with condition="contains" and
   action="replace", if rule.match equals one of the raw option strings
   then is_alias=True is set (the rule was generated from an alias).
   Rules whose match does not appear in the options list are left as-is
   (is_alias is not added / stays False).

Downgrade is a no-op.
"""
from __future__ import annotations

import json
from typing import Any, Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'ffc1c5a0d62f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_shape(column_mappings: Any) -> tuple[list[dict], bool]:
    """
    Convert legacy dict shape to canonical list shape.
    Returns (list_of_entries, changed).
    """
    if isinstance(column_mappings, dict):
        entries = []
        for idx, (header, mapping) in enumerate(column_mappings.items()):
            entry = dict(mapping) if isinstance(mapping, dict) else {}
            entry.setdefault("column_index", idx)
            entry["header"] = header
            entries.append(entry)
        return entries, True

    if isinstance(column_mappings, list):
        return column_mappings, False

    return [], True


def _normalize_options(options: list) -> tuple[list[str], bool]:
    """
    Flatten [{raw, alias}] dicts to plain raw strings.
    Returns (normalized_list, changed).
    """
    result = []
    changed = False
    for o in options:
        if isinstance(o, dict) and "raw" in o:
            result.append(o["raw"])
            changed = True
        else:
            result.append(o)
    return result, changed


def _tag_alias_rules(rules: list[dict], raw_options: set[str]) -> tuple[list[dict], bool]:
    """
    Set is_alias=True on rules whose match value appears in raw_options.
    Returns (updated_rules, changed).
    """
    changed = False
    result = []
    for rule in rules:
        if (
            rule.get("condition") == "contains"
            and rule.get("action") == "replace"
            and rule.get("match") in raw_options
        ):
            if not rule.get("is_alias"):
                rule = {**rule, "is_alias": True}
                changed = True
        result.append(rule)
    return result, changed


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

        # 1. Normalise shape (dict → list)
        entries, shape_changed = _normalize_shape(mappings)

        # 2 & 3. Normalise options and tag alias rules per entry
        data_changed = False
        for entry in entries:
            if not isinstance(entry, dict):
                continue

            options = entry.get("options")
            raw_set: set[str] = set()

            if options and isinstance(options, list):
                normalized, opts_changed = _normalize_options(options)
                if opts_changed:
                    entry["options"] = normalized
                    data_changed = True
                raw_set = {o for o in normalized if isinstance(o, str)}

            rules = entry.get("rules")
            if rules and isinstance(rules, list) and raw_set:
                tagged, rules_changed = _tag_alias_rules(rules, raw_set)
                if rules_changed:
                    entry["rules"] = tagged
                    data_changed = True

        if not shape_changed and not data_changed:
            continue

        serialized = json.dumps(entries)
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
    # Shape and field changes cannot be reliably reversed.
    pass
