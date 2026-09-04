"""re-key form presets from dates to tracks

The numeric slot in a reserved field_key stops being a date and becomes a
TournamentTrack id: availability_{track}, lunch_{track}_{category},
event_preference_{track}. Track is the scope a question is really asked about
— it carries its own dates, venue and division, so "which day" and "which
site" stop being separate questions.

There is no honest automatic translation. A date maps to a track only when the
tournament has exactly one running that day, and even then the *shift groups*
inside each option would need re-checking against the track. So every existing
reserved field is reverted to an ordinary question instead: label, description
and option labels are kept, the reserved key becomes a slug of the label, and
entity-backed option values (shift id arrays, event id arrays, track
assignments) are replaced by the option's own label — they name entities that
the new key can no longer be trusted to scope. TDs re-apply the presets by
hand, which is also the only way to say which track each one belongs to.

The four write-through tables are emptied for the same reason: their rows were
produced by questions that no longer exist in that form, and lunch/event
preferences are being re-scoped from (date, category) and (key) to track
anyway. Dev data only.

Revision ID: eb2e5d683865
Revises: cd55d0d51b0b
Create Date: 2026-09-03
"""
from alembic import op
import sqlalchemy as sa


revision = 'eb2e5d683865'
down_revision = 'cd55d0d51b0b'
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
