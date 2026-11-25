"""convert stored filters to condition trees

Rewrites each display_config surface's legacy `filters` ({key: [values]}) as a
`filter` condition tree, and replaces the export presets' member_filters /
event_filters columns with member_filter / event_filter trees. Keys AND,
values within one key OR, as the legacy filters did. Sentinel values for "has
none" become is-empty rows. The event lists' shift, building and placement
filters are dropped: their replacements are per track, which the old values
don't say.

Revision ID: f7a3d8e2c614
Revises: e5b2c9d71f30
Create Date: 2026-11-23

"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7a3d8e2c614"
down_revision: str | Sequence[str] | None = "e5b2c9d71f30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ANY = "__any__"
LUNCH_UNANSWERED = "__unanswered__"
PAIRED = {"track", "assigned", "lunch", "event_pref", "shift"}
ROSTER_SURFACES = {"members_table", "assignment_card", "zones_members"}
EVENT_SURFACES = {"events_table", "assignments_events", "buildings_events"}
EVENT_UNSET = "__unset__"
STAFFING_VALUES = {"full", "short", "empty", "no_needs"}
DROPPED_EVENT_KEYS = {"shift", "shifts", "building", "placement"}
EMPTY_FILTER = {"op": "and", "conditions": []}


def _cond(field: str, values=(), op_: str = "any_of", group: str | None = None) -> dict:
    return {"field": field, "group": group, "op": op_, "values": list(values)}


def _roster_rows(field: str, values: list[str]) -> list[dict] | None:
    """One roster key's values as conditions to OR; None when the key
    narrowed nothing."""
    if field == "role":
        rows, ids = [], []
        for value in values:
            if value == "none":
                rows.append(_cond("role", op_="empty"))
            else:
                ids.append(value.removesuffix(f":{ANY}"))
        if ids:
            rows.append(_cond("role", ids))
        return rows
    if field not in PAIRED:
        return [_cond(field, values)]

    by_group: dict[str, list[str]] = {}
    for value in values:
        left, sep, right = value.partition(":")
        if sep and left and right:
            by_group.setdefault(left, []).append(right)
    rows = []
    for group, rights in by_group.items():
        if field == "assigned":
            picked = {r for r in rights if r in ("assigned", "unassigned")}
            if ANY in rights or len(picked) == 2:
                return None
            if picked:
                op_ = "not_empty" if picked == {"assigned"} else "empty"
                rows.append(_cond(field, op_=op_, group=group))
        elif field == "lunch":
            unanswered = LUNCH_UNANSWERED in rights
            if ANY in rights and unanswered:
                return None
            if ANY in rights:
                rows.append(_cond(field, op_="not_empty", group=group))
                continue
            if unanswered:
                rows.append(_cond(field, op_="empty", group=group))
            rest = [r for r in rights if r != LUNCH_UNANSWERED]
            if rest:
                rows.append(_cond(field, rest, group=group))
        elif field == "event_pref" and ANY in rights:
            ranks = [r for r in rights if r.startswith("rank:")]
            rows.append(
                _cond(field, ranks, group=group)
                if ranks
                else _cond(field, op_="not_empty", group=group)
            )
        elif ANY in rights:
            rows.append(_cond(field, op_="not_empty", group=group))
        else:
            rows.append(_cond(field, rights, group=group))
    return rows


def _event_rows(field: str, values: list[str]) -> list[dict] | None:
    if field in DROPPED_EVENT_KEYS:
        return None
    if field == "staffing":
        values = [v for v in values if v in STAFFING_VALUES]
        # The event's needs taken together, as against one role or age rule.
        return [_cond(field, values, group="all")] if values else None
    rest = [v for v in values if v != EVENT_UNSET]
    rows = [_cond(field, op_="empty")] if EVENT_UNSET in values else []
    if rest:
        rows.append(_cond(field, rest))
    return rows


def _tournament_rows(values: list[str]) -> list[dict]:
    """The admin users table's tournament key: "3" in it, "!3" not in it,
    "none" in no tournament. Exclusions AND; the rest OR."""
    excluded = [v[1:] for v in values if v.startswith("!")]
    included = [v for v in values if not v.startswith("!") and v != "none"]
    either = [_cond("tournament", op_="empty")] if "none" in values else []
    if included:
        either.append(_cond("tournament", included))
    rows = [_cond("tournament", excluded, op_="none_of")] if excluded else []
    if len(either) == 1:
        rows.extend(either)
    elif either:
        rows.append({"op": "or", "conditions": either})
    return rows


def _convert(filters: dict | None, kind: str) -> dict:
    """kind: "roster", "events", "admin_users" or "plain" (any other table)."""
    conditions: list[dict] = []
    for field, values in (filters or {}).items():
        if not isinstance(values, list):
            continue
        values = [v for v in values if isinstance(v, str)]
        if not values:
            continue
        if kind == "admin_users" and field == "tournament":
            conditions.extend(_tournament_rows(values))
            continue
        if kind == "roster":
            rows = _roster_rows(field, values)
        elif kind == "events":
            rows = _event_rows(field, values)
        else:
            rows = [_cond(field, values)]
        if not rows:
            continue
        conditions.append(rows[0] if len(rows) == 1 else {"op": "or", "conditions": rows})
    return {"op": "and", "conditions": conditions}


def _convert_config(config: dict | None, kind_of) -> dict | None:
    """The config with each surface's `filters` rewritten; None if unchanged."""
    if not isinstance(config, dict):
        return None
    changed = False
    out = {}
    for surface, settings in config.items():
        if isinstance(settings, dict) and "filters" in settings:
            settings = dict(settings)
            legacy = settings.pop("filters")
            tree = _convert(legacy, kind_of(surface))
            if tree["conditions"] and not settings.get("filter"):
                settings["filter"] = tree
            changed = True
        out[surface] = settings
    return out if changed else None


def _tournament_kind(surface: str) -> str:
    base = surface.partition(":")[0]
    if base in ROSTER_SURFACES:
        return "roster"
    return "events" if base in EVENT_SURFACES else "plain"


def _user_kind(surface: str) -> str:
    return "admin_users" if surface == "admin_users" else "plain"


def _rewrite_configs(conn, table: str, kind_of) -> None:
    rows = conn.execute(sa.text(f"SELECT id, display_config FROM {table}")).all()
    for row_id, config in rows:
        converted = _convert_config(config, kind_of)
        if converted is not None:
            conn.execute(
                sa.text(f"UPDATE {table} SET display_config = CAST(:c AS json) WHERE id = :id"),
                {"c": json.dumps(converted), "id": row_id},
            )


def upgrade() -> None:
    conn = op.get_bind()
    _rewrite_configs(conn, "tournament_memberships", _tournament_kind)
    _rewrite_configs(conn, "users", _user_kind)

    empty = sa.text(f"'{json.dumps(EMPTY_FILTER)}'::json")
    op.add_column(
        "tournament_export_presets",
        sa.Column("member_filter", sa.JSON(), nullable=False, server_default=empty),
    )
    op.add_column(
        "tournament_export_presets",
        sa.Column("event_filter", sa.JSON(), nullable=False, server_default=empty),
    )
    presets = conn.execute(
        sa.text("SELECT id, member_filters, event_filters FROM tournament_export_presets")
    ).all()
    for preset_id, member_filters, event_filters in presets:
        conn.execute(
            sa.text(
                "UPDATE tournament_export_presets SET member_filter = CAST(:m AS json), "
                "event_filter = CAST(:e AS json) WHERE id = :id"
            ),
            {
                "m": json.dumps(_convert(member_filters, "roster")),
                "e": json.dumps(_convert(event_filters, "events")),
                "id": preset_id,
            },
        )
    op.drop_column("tournament_export_presets", "member_filters")
    op.drop_column("tournament_export_presets", "event_filters")


def downgrade() -> None:
    # The trees can't all be expressed as the old dicts, so the presets'
    # filters come back empty and display configs keep their `filter`.
    op.add_column(
        "tournament_export_presets",
        sa.Column("event_filters", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.add_column(
        "tournament_export_presets",
        sa.Column("member_filters", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.drop_column("tournament_export_presets", "event_filter")
    op.drop_column("tournament_export_presets", "member_filter")
