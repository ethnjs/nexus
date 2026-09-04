"""attach shifts to tracks

A shift now belongs to one primary track's day rather than to the tournament
at large, so it can be bounded by that track's own range: with Day 1 on Feb 13
and Day 2 on Feb 20, a Day 1 shift on Feb 20 is a mistake the tournament-wide
range could never catch.

Backfill is unambiguous because it runs right after 3a4dffebf0e1, which gave
every existing tournament exactly one primary track carrying the single date
range it used to have. Every shift belongs to that one.

Revision ID: 324a42e2b7ad
Revises: 3a4dffebf0e1
Create Date: 2026-09-03
"""
from alembic import op
import sqlalchemy as sa


revision = '324a42e2b7ad'
down_revision = '3a4dffebf0e1'
branch_labels = None
depends_on = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.drop_index('ix_tournament_shifts_track_id', table_name='tournament_shifts')
    op.drop_constraint('fk_tournament_shifts_track_id', 'tournament_shifts', type_='foreignkey')
    op.drop_column('tournament_shifts', 'track_id')
