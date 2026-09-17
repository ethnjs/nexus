"""per-track event logistics

Revision ID: 6a3b32e96e8c
Revises: d3b71a4c9e02
Create Date: 2026-09-15 14:35:01.345747

The single migration for the event-logistics branch (#81). Every step of that
work extends this file rather than adding a revision of its own, so a
deployment moves through one upgrade instead of five and the backfill sees the
whole picture at once.

Lossless so far. Every distinct building string an event carries becomes a
tournament_buildings row, tagged with the tracks that event runs on, and each
event<->track link takes the building, floor and room its event already had.

Events with a building but no track have nowhere to put it: the link rows are
the only storage, and an event on no track has none. Their building strings
still become catalog rows, so nothing is lost from the tournament's point of
view, but the event itself comes back unplaced.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6a3b32e96e8c'
down_revision: Union[str, None] = 'd3b71a4c9e02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # Buildings catalog
    # -----------------------------------------------------------------------
    op.create_table('tournament_buildings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tournament_id', 'name', name='uq_tournament_building_name')
    )
    op.create_index(op.f('ix_tournament_buildings_id'), 'tournament_buildings', ['id'], unique=False)
    op.create_index(op.f('ix_tournament_buildings_tournament_id'), 'tournament_buildings', ['tournament_id'], unique=False)

    # The (building_id, track_id) primary key here is also a foreign-key
    # target: an event's location names both, so the composite FK below is
    # what stops a Day 1 event being placed in a Day 2-only building.
    op.create_table('tournament_building_tracks',
    sa.Column('building_id', sa.Integer(), nullable=False),
    sa.Column('track_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['building_id'], ['tournament_buildings.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['track_id'], ['tournament_tracks.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('building_id', 'track_id')
    )

    # -----------------------------------------------------------------------
    # Event location moves onto the event<->track link
    # -----------------------------------------------------------------------
    op.add_column('tournament_event_tracks', sa.Column('building_id', sa.Integer(), nullable=True))
    op.add_column('tournament_event_tracks', sa.Column('floor', sa.String(length=64), nullable=True))
    op.add_column('tournament_event_tracks', sa.Column('rooms', sa.JSON(), nullable=True))
    op.create_index(op.f('ix_tournament_event_tracks_building_id'), 'tournament_event_tracks', ['building_id'], unique=False)

    # -----------------------------------------------------------------------
    # Backfill, before the foreign key exists — the FK is what requires every
    # (building, track) pair to be tagged, and the tagging is step 2 below.
    # -----------------------------------------------------------------------

    # 1. Each distinct building name per tournament becomes a catalog row.
    #    btrim because these were free text and " Rowland Hall" and
    #    "Rowland Hall" are the same building to everyone but the database.
    op.execute("""
        INSERT INTO tournament_buildings (tournament_id, name, created_at, updated_at)
        SELECT DISTINCT e.tournament_id, btrim(e.building), now(), now()
        FROM tournament_events e
        WHERE e.building IS NOT NULL AND btrim(e.building) <> ''
        ON CONFLICT (tournament_id, name) DO NOTHING
    """)

    # 2. Tag each building with every track an event using it runs on. Without
    #    this the composite FK below would reject the very rows step 3 writes.
    op.execute("""
        INSERT INTO tournament_building_tracks (building_id, track_id)
        SELECT DISTINCT b.id, et.track_id
        FROM tournament_event_tracks et
        JOIN tournament_events e ON e.id = et.tournament_event_id
        JOIN tournament_buildings b
          ON b.tournament_id = e.tournament_id AND b.name = btrim(e.building)
        WHERE e.building IS NOT NULL AND btrim(e.building) <> ''
        ON CONFLICT (building_id, track_id) DO NOTHING
    """)

    # 3. Copy the location onto every link row of that event. floor and rooms
    #    come across even when the building is blank — a TD who recorded only
    #    a room number keeps it. The LEFT JOIN leaves building_id NULL in that
    #    case rather than dropping the row from the update.
    op.execute("""
        UPDATE tournament_event_tracks et
        SET building_id = b.id,
            floor = NULLIF(btrim(e.floor), ''),
            rooms = CASE
                WHEN e.room IS NOT NULL AND btrim(e.room) <> ''
                THEN json_build_array(btrim(e.room))
                ELSE NULL
            END
        FROM tournament_events e
        LEFT JOIN tournament_buildings b
          ON b.tournament_id = e.tournament_id
         AND b.name = btrim(e.building)
         AND e.building IS NOT NULL
         AND btrim(e.building) <> ''
        WHERE et.tournament_event_id = e.id
    """)

    # Last, so the data it governs is already in place.
    #
    # RESTRICT, not SET NULL: track_id is half the link's primary key and
    # cannot be nulled, so the pair can't be cleared by the database. Deleting
    # a building, or untagging it from a track, has to clear the locations
    # pointing at it first — see the buildings routes.
    op.create_foreign_key('fk_event_track_building', 'tournament_event_tracks', 'tournament_building_tracks', ['building_id', 'track_id'], ['building_id', 'track_id'], ondelete='RESTRICT')


def downgrade() -> None:
    op.drop_constraint('fk_event_track_building', 'tournament_event_tracks', type_='foreignkey')
    op.drop_index(op.f('ix_tournament_event_tracks_building_id'), table_name='tournament_event_tracks')
    op.drop_column('tournament_event_tracks', 'rooms')
    op.drop_column('tournament_event_tracks', 'floor')
    op.drop_column('tournament_event_tracks', 'building_id')

    op.drop_table('tournament_building_tracks')
    op.drop_index(op.f('ix_tournament_buildings_tournament_id'), table_name='tournament_buildings')
    op.drop_index(op.f('ix_tournament_buildings_id'), table_name='tournament_buildings')
    op.drop_table('tournament_buildings')
