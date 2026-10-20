"""snapshot availability answers

Revision ID: 17852c91b77c
Revises: c3165a5fd87b
Create Date: 2026-10-19 19:38:55.900557

"""

import json
import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "17852c91b77c"
down_revision: str | Sequence[str] | None = "c3165a5fd87b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AVAILABILITY_KEY = re.compile(r"^availability_\d+")


def _availability_answers(conn):
    # The answer's own field_key is what it was given under; older rows
    # predate that column and fall back to the field's.
    rows = conn.execute(
        sa.text(
            """
            SELECT a.id, a.value, f.config, COALESCE(a.field_key, f.field_key)
            FROM form_answers a
            JOIN form_fields f ON f.id = a.field_id
            WHERE COALESCE(a.field_key, f.field_key) LIKE 'availability_%'
            """
        )
    ).fetchall()
    for answer_id, value, config, field_key in rows:
        if not AVAILABILITY_KEY.match(field_key):
            continue
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                pass
        if isinstance(config, str):
            config = json.loads(config)
        yield answer_id, value, config if isinstance(config, dict) else {}


def _save(conn, answer_id, value) -> None:
    conn.execute(
        sa.text("UPDATE form_answers SET value = CAST(:v AS json) WHERE id = :i"),
        {"v": json.dumps(value), "i": answer_id},
    )


def _snapshot(options: dict, item):
    option = options.get(item) if isinstance(item, str) else None
    if option is None:
        return item
    return {
        "option_id": option["option_id"],
        "value": option.get("value"),
        "label": option.get("label"),
    }


def _unwrap(item):
    return item.get("option_id") if isinstance(item, dict) else item


# Availability answers stored bare option ids; they now store the same
# {option_id, value, label} copy as other choice answers. The copy is taken
# from the option as it is now, since the original wasn't kept. An id whose
# option is gone from the config has nothing to copy and stays bare.
def upgrade() -> None:
    conn = op.get_bind()
    for answer_id, value, config in _availability_answers(conn):
        options = {o.get("option_id"): o for o in config.get("options") or []}
        if isinstance(value, list):
            new = [_snapshot(options, item) for item in value]
        else:
            new = _snapshot(options, value)
        if new != value:
            _save(conn, answer_id, new)


def downgrade() -> None:
    conn = op.get_bind()
    for answer_id, value, _config in _availability_answers(conn):
        new = [_unwrap(item) for item in value] if isinstance(value, list) else _unwrap(value)
        if new != value:
            _save(conn, answer_id, new)
