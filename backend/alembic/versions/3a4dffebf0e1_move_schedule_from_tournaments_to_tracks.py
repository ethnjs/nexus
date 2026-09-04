"""move schedule from tournaments to tracks

A tournament's when/where/what-division moves onto its tracks, so a regional
can run Day 1 at UCI in division C and Day 2 at Northwood in division B. Each
existing tournament gets one primary track carrying exactly what it had, named
after the tournament — the single-site case is unchanged from the outside, it
just now has a track behind it.

Revision ID: 3a4dffebf0e1
Revises: e5c2b7a91f38
Create Date: 2026-09-03
"""
from alembic import op
import sqlalchemy as sa


revision = '3a4dffebf0e1'
down_revision = 'e5c2b7a91f38'
branch_labels = None
depends_on = None


def upgrade() -> None:
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


def downgrade() -> None:
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
