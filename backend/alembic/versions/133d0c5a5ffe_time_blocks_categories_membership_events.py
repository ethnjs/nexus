"""Add time_blocks, tournament_categories, event_time_blocks, membership_events

Revision ID: 133d0c5a5ffe
Revises: 23ff6e84620b
Create Date: 2026-04-11

Migration sequence:
1. Create time_blocks, tournament_categories tables
2. Create event_time_blocks, membership_events association tables
3. Backfill time_blocks from tournaments.blocks JSON
4. Backfill event_time_blocks from events.blocks integer list
5. Add events.category_id, backfill from events.category string (find-or-create TournamentCategory)
6. Backfill membership_events from memberships.assigned_event_id
7. Migrate memberships.schedule JSON: replace block integers with time_block_ids
8. Drop legacy columns: tournaments.blocks, events.blocks, events.category, memberships.assigned_event_id
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

# revision identifiers
revision = '133d0c5a5ffe'
down_revision = '23ff6e84620b'
branch_labels = None
depends_on = None


def _has_column(conn, table: str, column: str) -> bool:
    insp = sa.inspect(conn)
    return any(c['name'] == column for c in insp.get_columns(table))


def upgrade():
    conn = op.get_bind()
    insp = sa.inspect(conn)

    # ------------------------------------------------------------------
    # 1. Create time_blocks
    # ------------------------------------------------------------------
    if not insp.has_table('time_blocks'):
        op.create_table(
            'time_blocks',
            sa.Column('id', sa.Integer(), primary_key=True, index=True, nullable=False),
            sa.Column('tournament_id', sa.Integer(), sa.ForeignKey('tournaments.id', ondelete='CASCADE'), nullable=False),
            sa.Column('label', sa.String(255), nullable=False),
            sa.Column('date', sa.String(10), nullable=False),
            sa.Column('start', sa.String(5), nullable=False),
            sa.Column('end', sa.String(5), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_time_blocks_id', 'time_blocks', ['id'])

    # ------------------------------------------------------------------
    # 2. Create tournament_categories
    # ------------------------------------------------------------------
    if not insp.has_table('tournament_categories'):
        op.create_table(
            'tournament_categories',
            sa.Column('id', sa.Integer(), primary_key=True, index=True, nullable=False),
            sa.Column('tournament_id', sa.Integer(), sa.ForeignKey('tournaments.id', ondelete='CASCADE'), nullable=False),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('is_custom', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('tournament_id', 'name', name='uq_tournament_category_name'),
        )
        op.create_index('ix_tournament_categories_id', 'tournament_categories', ['id'])

    # ------------------------------------------------------------------
    # 3. Create event_time_blocks association table
    # ------------------------------------------------------------------
    if not insp.has_table('event_time_blocks'):
        op.create_table(
            'event_time_blocks',
            sa.Column('event_id', sa.Integer(), sa.ForeignKey('events.id', ondelete='CASCADE'), primary_key=True, nullable=False),
            sa.Column('time_block_id', sa.Integer(), sa.ForeignKey('time_blocks.id', ondelete='CASCADE'), primary_key=True, nullable=False),
        )

    # ------------------------------------------------------------------
    # 4. Create membership_events association table
    # ------------------------------------------------------------------
    if not insp.has_table('membership_events'):
        op.create_table(
            'membership_events',
            sa.Column('membership_id', sa.Integer(), sa.ForeignKey('memberships.id', ondelete='CASCADE'), primary_key=True, nullable=False),
            sa.Column('event_id', sa.Integer(), sa.ForeignKey('events.id', ondelete='CASCADE'), primary_key=True, nullable=False),
        )

    # ------------------------------------------------------------------
    # 5. Backfill time_blocks from tournaments.blocks JSON
    #    tournaments.blocks is a list of objects:
    #    [{"number": 1, "label": "Block 1", "date": "YYYY-MM-DD", "start": "HH:MM", "end": "HH:MM"}, ...]
    #    We build a mapping: (tournament_id, old_number) -> new time_block id
    # ------------------------------------------------------------------
    import json
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # old_number_to_id[tournament_id][block_number] = new time_block id
    old_number_to_id = {}

    tournaments = conn.execute(text("SELECT id, blocks FROM tournaments WHERE blocks IS NOT NULL")).fetchall()
    for t_id, blocks_json in tournaments:
        if not blocks_json:
            continue
        if isinstance(blocks_json, str):
            blocks_json = json.loads(blocks_json)
        old_number_to_id[t_id] = {}
        for block in blocks_json:
            number = block.get("number")
            label = block.get("label", f"Block {number}")
            date = block.get("date", "")
            start = block.get("start", "00:00")
            end = block.get("end", "00:00")

            result = conn.execute(
                text(
                    "INSERT INTO time_blocks (tournament_id, label, date, start, end, created_at, updated_at) "
                    "VALUES (:tid, :label, :date, :start, :end, :now, :now) RETURNING id"
                ),
                {"tid": t_id, "label": label, "date": date, "start": start, "end": end, "now": now},
            )
            new_id = result.fetchone()[0]
            if number is not None:
                old_number_to_id[t_id][number] = new_id

    # ------------------------------------------------------------------
    # 6. Backfill event_time_blocks from events.blocks (list of ints)
    # ------------------------------------------------------------------
    events = conn.execute(text("SELECT id, tournament_id, blocks FROM events WHERE blocks IS NOT NULL")).fetchall()
    for e_id, t_id, blocks_json in events:
        if not blocks_json:
            continue
        if isinstance(blocks_json, str):
            blocks_json = json.loads(blocks_json)
        t_map = old_number_to_id.get(t_id, {})
        for block_num in blocks_json:
            tb_id = t_map.get(block_num)
            if tb_id is None:
                continue
            conn.execute(
                text("INSERT INTO event_time_blocks (event_id, time_block_id) VALUES (:eid, :tbid) ON CONFLICT DO NOTHING"),
                {"eid": e_id, "tbid": tb_id},
            )

    # ------------------------------------------------------------------
    # 7. Add events.category_id and backfill from events.category string
    # ------------------------------------------------------------------
    if not _has_column(conn, 'events', 'category_id'):
        op.add_column('events', sa.Column('category_id', sa.Integer(), sa.ForeignKey('tournament_categories.id', ondelete='SET NULL'), nullable=True))

    # For each distinct (tournament_id, category) string pair, find-or-create a TournamentCategory row
    rows = conn.execute(text(
        "SELECT DISTINCT tournament_id, category FROM events WHERE category IS NOT NULL AND category != ''"
    )).fetchall()

    cat_cache = {}  # (tournament_id, name) -> category_id
    for t_id, cat_name in rows:
        key = (t_id, cat_name)
        if key in cat_cache:
            continue
        existing = conn.execute(
            text("SELECT id FROM tournament_categories WHERE tournament_id = :tid AND name = :name"),
            {"tid": t_id, "name": cat_name},
        ).fetchone()
        if existing:
            cat_cache[key] = existing[0]
        else:
            result = conn.execute(
                text(
                    "INSERT INTO tournament_categories (tournament_id, name, is_custom, created_at) "
                    "VALUES (:tid, :name, TRUE, :now) RETURNING id"
                ),
                {"tid": t_id, "name": cat_name, "now": now},
            )
            cat_cache[key] = result.fetchone()[0]

    # Update events.category_id
    for (t_id, cat_name), cat_id in cat_cache.items():
        conn.execute(
            text("UPDATE events SET category_id = :cid WHERE tournament_id = :tid AND category = :name"),
            {"cid": cat_id, "tid": t_id, "name": cat_name},
        )

    # ------------------------------------------------------------------
    # 8. Backfill membership_events from memberships.assigned_event_id
    # ------------------------------------------------------------------
    memberships = conn.execute(
        text("SELECT id, assigned_event_id FROM memberships WHERE assigned_event_id IS NOT NULL")
    ).fetchall()
    for m_id, e_id in memberships:
        conn.execute(
            text("INSERT INTO membership_events (membership_id, event_id) VALUES (:mid, :eid) ON CONFLICT DO NOTHING"),
            {"mid": m_id, "eid": e_id},
        )

    # ------------------------------------------------------------------
    # 9. Migrate memberships.schedule JSON:
    #    [{block: int, duty: str}] -> [{time_block_id: int, duty: str}]
    # ------------------------------------------------------------------
    memberships_with_schedule = conn.execute(
        text("SELECT id, tournament_id, schedule FROM memberships WHERE schedule IS NOT NULL")
    ).fetchall()
    for m_id, t_id, schedule_json in memberships_with_schedule:
        if not schedule_json:
            continue
        if isinstance(schedule_json, str):
            schedule_json = json.loads(schedule_json)
        t_map = old_number_to_id.get(t_id, {})
        new_schedule = []
        changed = False
        for entry in schedule_json:
            block_num = entry.get("block")
            if block_num is not None and block_num in t_map:
                new_schedule.append({"time_block_id": t_map[block_num], "duty": entry.get("duty", "")})
                changed = True
            else:
                new_schedule.append(entry)
        if changed:
            conn.execute(
                text("UPDATE memberships SET schedule = :s WHERE id = :mid"),
                {"s": json.dumps(new_schedule), "mid": m_id},
            )

    # ------------------------------------------------------------------
    # 10. Drop legacy columns
    # ------------------------------------------------------------------
    if _has_column(conn, 'tournaments', 'blocks'):
        op.drop_column('tournaments', 'blocks')
    if _has_column(conn, 'events', 'blocks'):
        op.drop_column('events', 'blocks')
    if _has_column(conn, 'events', 'category'):
        op.drop_column('events', 'category')
    if _has_column(conn, 'memberships', 'assigned_event_id'):
        op.drop_column('memberships', 'assigned_event_id')


def downgrade():
    conn = op.get_bind()
    insp = sa.inspect(conn)

    # Re-add legacy columns
    op.add_column('memberships', sa.Column('assigned_event_id', sa.Integer(), sa.ForeignKey('events.id', ondelete='SET NULL'), nullable=True))
    op.add_column('events', sa.Column('category', sa.String(255), nullable=True))
    op.add_column('events', sa.Column('blocks', sa.JSON(), nullable=True))
    op.add_column('tournaments', sa.Column('blocks', sa.JSON(), nullable=True))

    # Restore events.category from category_id
    conn.execute(text("""
        UPDATE events e
        SET category = (
            SELECT tc.name FROM tournament_categories tc WHERE tc.id = e.category_id
        )
        WHERE e.category_id IS NOT NULL
    """))

    if _has_column(conn, 'events', 'category_id'):
        op.drop_column('events', 'category_id')

    # Drop new tables (cascade handles association tables)
    if insp.has_table('membership_events'):
        op.drop_table('membership_events')
    if insp.has_table('event_time_blocks'):
        op.drop_table('event_time_blocks')
    if insp.has_table('tournament_categories'):
        op.drop_table('tournament_categories')
    if insp.has_table('time_blocks'):
        op.drop_table('time_blocks')
