"""normalize column_mappings options to list[str]

Revision ID: f6a7b8c9d0e1
Revises: e975e198a8e1
Create Date: 2026-04-02

Data migration: ColumnMapping.options was previously stored as
list[{raw, alias}] objects. It is now list[str] (raw strings only),
with aliases encoded as is_alias=True rules on the mapping.

This migration flattens any {raw, alias} objects in options to just
the raw string. Entries that are already strings are left as-is.

Downgrade is a no-op — alias information cannot be reconstructed
from raw strings alone without the corresponding rules.
"""
from __future__ import annotations

import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'ffc1c5a0d62f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _normalize_options(options: list) -> tuple[list, bool]:
    """
    Flatten any {raw, alias} dicts in options to plain raw strings.
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

        # SQLite returns JSON columns as strings; PostgreSQL returns native objects.
        mappings = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(mappings, list):
            continue

        changed = False
        for entry in mappings:
            if not isinstance(entry, dict):
                continue
            options = entry.get("options")
            if not options or not isinstance(options, list):
                continue
            normalized, entry_changed = _normalize_options(options)
            if entry_changed:
                entry["options"] = normalized
                changed = True

        if not changed:
            continue

        serialized = json.dumps(mappings)
        if dialect == "postgresql":
            bind.execute(
                sa.text(
                    "UPDATE sheet_configs SET column_mappings = cast(:cm AS jsonb) WHERE id = :id"
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
    # Cannot reconstruct {raw, alias} pairs from raw strings alone.
    pass
