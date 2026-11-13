"""fold experience card columns into one entry per table

Revision ID: b8e2d4f61a37
Revises: f44f9009af1f
Create Date: 2026-11-13

"""

import json
from collections.abc import Callable, Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8e2d4f61a37"
down_revision: str | Sequence[str] | None = "f44f9009af1f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


CARD_FIELD = "card_field:"
TABLE_COLUMNS = {
    "competition_experience": ["competition_school", "competition_event"],
    "volunteer_experience": ["volunteer_tournament", "volunteer_event", "volunteer_role"],
}


def _fold(hidden: list) -> list:
    """A table stays hidden only if every one of its old columns was."""
    old = {column for columns in TABLE_COLUMNS.values() for column in columns}
    fields = {
        item[len(CARD_FIELD) :]
        for item in hidden
        if isinstance(item, str) and item.startswith(CARD_FIELD)
    }
    kept = [
        item
        for item in hidden
        if not (
            isinstance(item, str) and item.startswith(CARD_FIELD) and item[len(CARD_FIELD) :] in old
        )
    ]
    for table, columns in TABLE_COLUMNS.items():
        entry = f"{CARD_FIELD}{table}"
        if all(column in fields for column in columns) and entry not in kept:
            kept.append(entry)
    return kept


def _unfold(hidden: list) -> list:
    kept = []
    for item in hidden:
        table = (
            item[len(CARD_FIELD) :]
            if isinstance(item, str) and item.startswith(CARD_FIELD)
            else None
        )
        if table in TABLE_COLUMNS:
            kept.extend(f"{CARD_FIELD}{column}" for column in TABLE_COLUMNS[table])
        else:
            kept.append(item)
    return kept


def _migrate(rewrite: Callable[[list], list]) -> None:
    conn = op.get_bind()
    for row_id, config in conn.execute(
        sa.text(
            "SELECT id, display_config FROM tournament_memberships WHERE display_config IS NOT NULL"
        )
    ).fetchall():
        before = json.loads(config) if isinstance(config, str) else config
        if not isinstance(before, dict):
            continue
        after = json.loads(json.dumps(before))
        for surface in after.values():
            if isinstance(surface, dict) and isinstance(surface.get("hidden"), list):
                surface["hidden"] = rewrite(surface["hidden"])
        if after != before:
            conn.execute(
                sa.text(
                    "UPDATE tournament_memberships SET display_config = CAST(:v AS json) WHERE id = :i"
                ),
                {"v": json.dumps(after), "i": row_id},
            )


# The member card's experience tables were one setting per column and are now
# one per table. The old keys are rejected on write, and every save re-sends
# the whole config, so a view still holding them could not be saved at all.
def upgrade() -> None:
    _migrate(_fold)


def downgrade() -> None:
    _migrate(_unfold)
