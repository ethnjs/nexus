"""tracks own the schedule, the shifts, the events and the form presets

One migration, four related moves — folded together because they were built
and applied as one piece of work and no database has ever seen them apart.

  1. A tournament's when/where/what-division moves onto its *tracks*, so a
     regional can run Day 1 at UCI in division C and Day 2 at Northwood in
     division B. Each existing tournament gets one primary track carrying
     exactly what it had.
  2. A shift belongs to one primary track's day, so it can be bounded by that
     track's own range: with Day 1 on Feb 13 and Day 2 on Feb 20, a Day 1
     shift on Feb 20 is a mistake the tournament-wide range could never catch.
  3. An event says which tracks it runs on, explicitly — a cosmetic track like
     Test Writing has no shifts, so a shift-derived link could never reach it.
     With that stated outright, an event's own start_time/end_time become a
     second answer to "when does this run" that can disagree with the shifts
     people sign up for, so they go.
  4. The numeric slot in a reserved field_key stops being a date and becomes a
     track id. There is no honest automatic translation, so every existing
     reserved field is reverted to an ordinary question and the four
     write-through tables are emptied. Dev data only.

Revision ID: eb2e5d683865
Revises: e5c2b7a91f38
Create Date: 2026-09-03
"""
from alembic import op
import sqlalchemy as sa


revision = 'eb2e5d683865'
down_revision = 'e5c2b7a91f38'
branch_labels = None
depends_on = None

# The old grammar, matched loosely — anything that *was* a preset key.
OLD_PRESET_REGEX = (
    r'^(availability_\d{8}(_[a-z0-9_]+)?'
    r'|lunch_\d{8}_[a-z0-9_]+'
    r'|event_preference_[a-z0-9_]+'
    r'|track_status_[a-z0-9_]+)$'
)


def upgrade() -> None:
    # --- B1 — schedule moves onto tracks -------------------------------------
    op.add_column('tournament_tracks', sa.Column('is_primary', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('tournament_tracks', sa.Column('start_date', sa.Date(), nullable=True))
    op.add_column('tournament_tracks', sa.Column('end_date', sa.Date(), nullable=True))
    op.add_column('tournament_tracks', sa.Column('university_id', sa.Integer(), nullable=True))
    op.add_column('tournament_tracks', sa.Column('location', sa.String(length=255), nullable=True))
    op.add_column('tournament_tracks', sa.Column('division', sa.JSON(), nullable=True))
    op.create_foreign_key(
        'fk_tournament_tracks_university_id', 'tournament_tracks', 'universities',
        ['university_id'], ['id'],
    )

    # One primary track per existing tournament, carrying what the tournament
    # itself held. Named after the tournament (short_name preferred) so the
    # settings list reads sensibly; suffixed on the rare collision with a
    # track the TD already created under that name.
    op.execute("""
        INSERT INTO tournament_tracks
            (tournament_id, name, is_primary, start_date, end_date,
             university_id, location, division, is_archived, allow_confirm,
             created_at, updated_at)
        SELECT
            t.id,
            CASE WHEN EXISTS (
                SELECT 1 FROM tournament_tracks x
                WHERE x.tournament_id = t.id
                  AND x.name = COALESCE(t.short_name, t.name)
            ) THEN COALESCE(t.short_name, t.name) || ' (main)'
            ELSE COALESCE(t.short_name, t.name) END,
            true, t.start_date, t.end_date, t.university_id, t.location,
            t.division, false, false, NOW(), NOW()
        FROM tournaments t
    """)

    op.drop_constraint('tournaments_university_id_fkey', 'tournaments', type_='foreignkey')
    op.drop_column('tournaments', 'start_date')
    op.drop_column('tournaments', 'end_date')
    op.drop_column('tournaments', 'university_id')
    op.drop_column('tournaments', 'location')
    op.drop_column('tournaments', 'division')

    op.alter_column('tournament_tracks', 'is_primary', server_default=None)

    # --- B2 — shifts belong to a track ---------------------------------------
    op.add_column('tournament_shifts', sa.Column('track_id', sa.Integer(), nullable=True))

    # Earliest primary track per tournament. DISTINCT ON picks one row even in
    # the (post-refactor, not yet possible here) multi-track case, so the
    # backfill can't leave a NULL behind and trip the NOT NULL below.
    op.execute("""
        UPDATE tournament_shifts s SET track_id = t.id
        FROM (
            SELECT DISTINCT ON (tournament_id) tournament_id, id
            FROM tournament_tracks
            WHERE is_primary AND NOT is_archived
            ORDER BY tournament_id, start_date, id
        ) t
        WHERE t.tournament_id = s.tournament_id
    """)

    op.alter_column('tournament_shifts', 'track_id', nullable=False)
    op.create_foreign_key(
        'fk_tournament_shifts_track_id', 'tournament_shifts', 'tournament_tracks',
        ['track_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index('ix_tournament_shifts_track_id', 'tournament_shifts', ['track_id'])

    # --- B3 — events link to tracks, lose their own times --------------------
    op.create_table(
        'tournament_event_tracks',
        sa.Column('tournament_event_id', sa.Integer(), nullable=False),
        sa.Column('track_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['tournament_event_id'], ['tournament_events.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['track_id'], ['tournament_tracks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('tournament_event_id', 'track_id'),
    )

    # Backfill from each event's shifts. An event with no shifts gets no
    # tracks and must be linked by hand — that's exactly the Test Writing
    # case this bridge exists for, and there's nothing to guess from.
    op.execute("""
        INSERT INTO tournament_event_tracks (tournament_event_id, track_id)
        SELECT DISTINCT es.tournament_event_id, s.track_id
        FROM tournament_event_shifts es
        JOIN tournament_shifts s ON s.id = es.tournament_shift_id
    """)

    op.drop_column('tournament_events', 'start_time')
    op.drop_column('tournament_events', 'end_time')

    # --- B4 — presets re-keyed to tracks -------------------------------------
    conn = op.get_bind()

    # --- 1. Revert every reserved field to a plain question -----------------
    # field_key becomes a slug of the label, deduped per form with a numeric
    # suffix. The unique index is partial (live fields only), so an archived
    # field colliding with a live one is fine and isn't worked around here.
    fields = conn.execute(sa.text(f"""
        SELECT id, form_id, label, field_key, config
        FROM form_fields
        WHERE field_key ~ '{OLD_PRESET_REGEX}'
        ORDER BY form_id, "order", id
    """)).fetchall()

    taken: dict[str, set[str]] = {}
    for form_id, existing_key in conn.execute(sa.text("SELECT form_id, field_key FROM form_fields")):
        taken.setdefault(form_id, set()).add(existing_key)

    import json
    import re

    for field_id, form_id, label, old_key, config in fields:
        # field_key is varchar(64); a question label is a whole sentence, so
        # the slug has to be clipped before the dedup suffix is appended.
        base = re.sub(r'[^a-z0-9]+', '_', (label or 'question').lower()).strip('_') or 'question'
        base = base[:56].rstrip('_') or 'question'
        candidate, n = base, 2
        while candidate in taken.setdefault(form_id, set()):
            candidate, n = f"{base}_{n}", n + 1
        taken[form_id].add(candidate)

        # Entity-backed option values (list[int] of shift/event ids, track
        # assignment lists, the availability {shift_ids, track_statuses}
        # shape) can't survive as plain text — replace each with the option's
        # own label, which is the part a respondent ever saw.
        parsed = config if isinstance(config, dict) else (json.loads(config) if config else None)
        if isinstance(parsed, dict):
            for option in parsed.get('options') or []:
                if not isinstance(option.get('value'), str):
                    option['value'] = option.get('label') or ''
            parsed.pop('track_status_enabled', None)

        conn.execute(
            sa.text("UPDATE form_fields SET field_key = :k, config = CAST(:c AS json) WHERE id = :i"),
            {"k": candidate, "c": json.dumps(parsed) if parsed is not None else None, "i": field_id},
        )
        # form_answers snapshots the key alongside the answer so an old
        # response stays readable; it has to move with the field.
        conn.execute(
            sa.text("UPDATE form_answers SET field_key = :k WHERE field_id = :i"),
            {"k": candidate, "i": field_id},
        )

    # --- 2. Empty the write-through tables ----------------------------------
    for table in (
        'tournament_membership_availability',
        'tournament_membership_lunch',
        'tournament_membership_event_preferences',
        'tournament_membership_track_statuses',
    ):
        conn.execute(sa.text(f"DELETE FROM {table}"))

    # --- 3. Re-scope lunch and event preferences to tracks ------------------
    op.drop_constraint('uq_membership_lunch_selection', 'tournament_membership_lunch', type_='unique')
    op.add_column('tournament_membership_lunch', sa.Column('track_id', sa.Integer(), nullable=False))
    op.create_foreign_key(
        'fk_membership_lunch_track_id', 'tournament_membership_lunch', 'tournament_tracks',
        ['track_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index('ix_tournament_membership_lunch_track_id', 'tournament_membership_lunch', ['track_id'])
    op.drop_column('tournament_membership_lunch', 'date')
    op.create_unique_constraint(
        'uq_membership_lunch_selection', 'tournament_membership_lunch',
        ['membership_id', 'track_id', 'category', 'value'],
    )

    op.drop_constraint(
        'uq_membership_event_preference', 'tournament_membership_event_preferences', type_='unique',
    )
    op.add_column(
        'tournament_membership_event_preferences', sa.Column('track_id', sa.Integer(), nullable=False),
    )
    op.create_foreign_key(
        'fk_membership_event_preference_track_id', 'tournament_membership_event_preferences',
        'tournament_tracks', ['track_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index(
        'ix_tournament_membership_event_preferences_track_id',
        'tournament_membership_event_preferences', ['track_id'],
    )
    op.drop_column('tournament_membership_event_preferences', 'key')
    op.create_unique_constraint(
        'uq_membership_event_preference', 'tournament_membership_event_preferences',
        ['membership_id', 'track_id', 'tournament_event_id'],
    )


def downgrade() -> None:
    # --- B4 — presets re-keyed to tracks -------------------------------------
    # The field reverts are not undone — the original reserved keys named
    # dates that no longer exist anywhere, so there is nothing to restore
    # them from. Only the schema moves back.
    conn = op.get_bind()
    for table in (
        'tournament_membership_lunch',
        'tournament_membership_event_preferences',
    ):
        conn.execute(sa.text(f"DELETE FROM {table}"))

    op.drop_constraint(
        'uq_membership_event_preference', 'tournament_membership_event_preferences', type_='unique',
    )
    op.add_column(
        'tournament_membership_event_preferences', sa.Column('key', sa.String(length=64), nullable=False),
    )
    op.drop_index(
        'ix_tournament_membership_event_preferences_track_id',
        table_name='tournament_membership_event_preferences',
    )
    op.drop_constraint(
        'fk_membership_event_preference_track_id', 'tournament_membership_event_preferences',
        type_='foreignkey',
    )
    op.drop_column('tournament_membership_event_preferences', 'track_id')
    op.create_unique_constraint(
        'uq_membership_event_preference', 'tournament_membership_event_preferences',
        ['membership_id', 'key', 'tournament_event_id'],
    )

    op.drop_constraint('uq_membership_lunch_selection', 'tournament_membership_lunch', type_='unique')
    op.add_column('tournament_membership_lunch', sa.Column('date', sa.Date(), nullable=False))
    op.drop_index('ix_tournament_membership_lunch_track_id', table_name='tournament_membership_lunch')
    op.drop_constraint('fk_membership_lunch_track_id', 'tournament_membership_lunch', type_='foreignkey')
    op.drop_column('tournament_membership_lunch', 'track_id')
    op.create_unique_constraint(
        'uq_membership_lunch_selection', 'tournament_membership_lunch',
        ['membership_id', 'date', 'category', 'value'],
    )

    # --- B3 — events link to tracks, lose their own times --------------------
    op.add_column('tournament_events', sa.Column('start_time', sa.DateTime(timezone=True), nullable=True))
    op.add_column('tournament_events', sa.Column('end_time', sa.DateTime(timezone=True), nullable=True))

    # Rebuild the times from the shifts they were replaced by. An event with
    # no shifts keeps both null, which is what it would have had anyway.
    op.execute("""
        UPDATE tournament_events e SET
            start_time = agg.start_time,
            end_time = agg.end_time
        FROM (
            SELECT es.tournament_event_id,
                   MIN(s.start) AS start_time,
                   MAX(s."end") AS end_time
            FROM tournament_event_shifts es
            JOIN tournament_shifts s ON s.id = es.tournament_shift_id
            GROUP BY es.tournament_event_id
        ) agg
        WHERE e.id = agg.tournament_event_id
    """)

    op.drop_table('tournament_event_tracks')

    # --- B2 — shifts belong to a track ---------------------------------------
    op.drop_index('ix_tournament_shifts_track_id', table_name='tournament_shifts')
    op.drop_constraint('fk_tournament_shifts_track_id', 'tournament_shifts', type_='foreignkey')
    op.drop_column('tournament_shifts', 'track_id')

    # --- B1 — schedule moves onto tracks -------------------------------------
    op.add_column('tournaments', sa.Column('start_date', sa.Date(), nullable=True))
    op.add_column('tournaments', sa.Column('end_date', sa.Date(), nullable=True))
    op.add_column('tournaments', sa.Column('university_id', sa.Integer(), nullable=True))
    op.add_column('tournaments', sa.Column('location', sa.String(length=255), nullable=True))
    op.add_column('tournaments', sa.Column('division', sa.JSON(), nullable=True))
    op.create_foreign_key(
        'tournaments_university_id_fkey', 'tournaments', 'universities',
        ['university_id'], ['id'],
    )

    # Fold the primary tracks back into one row per tournament. Lossy by
    # nature: a multi-site tournament collapses to its aggregate range and
    # loses every venue but the earliest track's.
    op.execute("""
        UPDATE tournaments t SET
            start_date = agg.start_date,
            end_date = agg.end_date,
            university_id = agg.university_id,
            location = agg.location,
            division = agg.division
        FROM (
            SELECT DISTINCT ON (tr.tournament_id)
                tr.tournament_id,
                MIN(tr.start_date) OVER (PARTITION BY tr.tournament_id) AS start_date,
                MAX(tr.end_date) OVER (PARTITION BY tr.tournament_id) AS end_date,
                tr.university_id,
                tr.location,
                tr.division
            FROM tournament_tracks tr
            WHERE tr.is_primary AND NOT tr.is_archived
            ORDER BY tr.tournament_id, tr.start_date
        ) agg
        WHERE t.id = agg.tournament_id
    """)
    op.execute("DELETE FROM tournament_tracks WHERE is_primary")

    op.alter_column('tournaments', 'start_date', nullable=False)
    op.alter_column('tournaments', 'end_date', nullable=False)
    op.alter_column('tournaments', 'division', nullable=False)

    op.drop_constraint('fk_tournament_tracks_university_id', 'tournament_tracks', type_='foreignkey')
    op.drop_column('tournament_tracks', 'division')
    op.drop_column('tournament_tracks', 'location')
    op.drop_column('tournament_tracks', 'university_id')
    op.drop_column('tournament_tracks', 'end_date')
    op.drop_column('tournament_tracks', 'start_date')
    op.drop_column('tournament_tracks', 'is_primary')
