"""key custom answer settings by field key

Revision ID: fc57ee38d581
Revises: d997385d3370
Create Date: 2026-10-27 18:45:31.974159

"""

import json
from collections.abc import Callable, Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fc57ee38d581"
down_revision: str | Sequence[str] | None = "d997385d3370"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


OLD_PANEL = "form_field:"
NEW_PANEL = "field_key:"
CARD = "card_custom:"

# Maps one stored entry, or returns None to drop it.
Rewrite = Callable[[str], str | None]


def _load(value):
    return json.loads(value) if isinstance(value, str) else value


def _dedupe(items: list, key=lambda item: item) -> list:
    seen = set()
    kept = []
    for item in items:
        if key(item) not in seen:
            seen.add(key(item))
            kept.append(item)
    return kept


def _rewrite_strings(items, rewrite: Rewrite):
    if not isinstance(items, list):
        return items
    mapped = [rewrite(item) if isinstance(item, str) else item for item in items]
    return _dedupe([item for item in mapped if item is not None])


def _rewrite_display_config(config, rewrite: Rewrite):
    if not isinstance(config, dict):
        return config
    for surface in config.values():
        if not isinstance(surface, dict):
            continue
        for list_key in ("hidden", "columns"):
            if surface.get(list_key) is not None:
                surface[list_key] = _rewrite_strings(surface[list_key], rewrite)
        for section in surface.get("sections") or []:
            if isinstance(section, dict) and section.get("fields"):
                section["fields"] = _rewrite_strings(section["fields"], rewrite)
    return config


def _rewrite_objects(items, attr: str, rewrite: Rewrite):
    if not isinstance(items, list):
        return items
    kept = []
    for item in items:
        if isinstance(item, dict) and isinstance(item.get(attr), str):
            mapped = rewrite(item[attr])
            if mapped is None:
                continue
            item = {**item, attr: mapped}
        kept.append(item)
    return _dedupe(kept, key=lambda item: item.get(attr) if isinstance(item, dict) else id(item))


def _migrate(conn, rewriter_for: Callable[[int], Rewrite]) -> None:
    for row_id, tournament_id, config in conn.execute(
        sa.text("SELECT id, tournament_id, display_config FROM tournament_memberships")
    ).fetchall():
        before = _load(config)
        after = _rewrite_display_config(json.loads(json.dumps(before)), rewriter_for(tournament_id))
        if after != before:
            conn.execute(
                sa.text(
                    "UPDATE tournament_memberships SET display_config = CAST(:v AS json) WHERE id = :i"
                ),
                {"v": json.dumps(after), "i": row_id},
            )

    for row_id, tournament_id, columns, sorts in conn.execute(
        sa.text("SELECT id, tournament_id, columns, sorts FROM tournament_export_presets")
    ).fetchall():
        rewrite = rewriter_for(tournament_id)
        columns, sorts = _load(columns), _load(sorts)
        new_columns = _rewrite_objects(columns, "key", rewrite)
        new_sorts = _rewrite_objects(sorts, "field", rewrite)
        if (new_columns, new_sorts) != (columns, sorts):
            conn.execute(
                sa.text(
                    "UPDATE tournament_export_presets "
                    "SET columns = CAST(:c AS json), sorts = CAST(:s AS json) WHERE id = :i"
                ),
                {"c": json.dumps(new_columns), "s": json.dumps(new_sorts), "i": row_id},
            )


# Saved panel, table, card and export settings named a custom question by its
# field id. Forms may now share a key and show the latest answer to it, so they
# name the key: "form_field:{id}" becomes "field_key:{key}" and
# "card_custom:{id}" becomes "card_custom:{key}". Entries that collapse onto
# one key are deduplicated, and an id whose field is gone (already inert) is
# dropped.
def upgrade() -> None:
    conn = op.get_bind()
    key_by_id = dict(conn.execute(sa.text("SELECT id, field_key FROM form_fields")).fetchall())

    def rewrite(item: str) -> str | None:
        for old, new in ((OLD_PANEL, NEW_PANEL), (CARD, CARD)):
            if item.startswith(old):
                key = key_by_id.get(item[len(old) :])
                return f"{new}{key}" if key else None
        return item

    _migrate(conn, lambda _tournament_id: rewrite)


# Each key goes back to the newest live field using it in that tournament,
# which may not be the field the setting first named.
def downgrade() -> None:
    conn = op.get_bind()
    id_by_key: dict[tuple[int, str], str] = {}
    for field_id, tournament_id, key in conn.execute(
        sa.text(
            """
            SELECT f.id, fm.tournament_id, f.field_key
            FROM form_fields f JOIN forms fm ON fm.id = f.form_id
            WHERE fm.tournament_id IS NOT NULL AND f.is_archived = false
            ORDER BY f.created_at
            """
        )
    ).fetchall():
        id_by_key[(tournament_id, key)] = field_id

    def rewriter_for(tournament_id: int) -> Rewrite:
        def rewrite(item: str) -> str | None:
            for new, old in ((NEW_PANEL, OLD_PANEL), (CARD, CARD)):
                if item.startswith(new):
                    field_id = id_by_key.get((tournament_id, item[len(new) :]))
                    return f"{old}{field_id}" if field_id else None
            return item

        return rewrite

    _migrate(conn, rewriter_for)
