"""link events to tracks and derive event days from shifts

An event now says which tracks it runs on, explicitly. Deriving that through
its shifts was the obvious first answer and it doesn't work: a cosmetic track
like Test Writing has no shifts by construction, so no event could ever belong
to it — even though Circuits genuinely needs to be on both Test Writing and
Day 1.

With tracks stated outright, an event's own start_time/end_time become a
second answer to "when does this run" that can disagree with the shifts people
actually sign up for. They go; the union of the event's shifts is the answer.

Revision ID: cd55d0d51b0b
Revises: 324a42e2b7ad
Create Date: 2026-09-03
"""
from alembic import op
import sqlalchemy as sa


revision = 'cd55d0d51b0b'
down_revision = '324a42e2b7ad'
branch_labels = None
depends_on = None


def upgrade() -> None:
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


def downgrade() -> None:
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
