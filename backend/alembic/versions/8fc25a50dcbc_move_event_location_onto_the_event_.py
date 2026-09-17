"""move event location onto the event-track link

Revision ID: 8fc25a50dcbc
Revises: 6a3b32e96e8c
Create Date: 2026-09-16 20:44:07.237859

Lossless. Every distinct building string an event carries becomes a
tournament_buildings row, tagged with the tracks that event runs on, and each
event<->track link takes the building, floor and room its event already had.
The old columns on tournament_events are left alone here — dropping them is a
later revision, so this one downgrades cleanly.

Events with a building but no track have nowhere to put it: the link rows are
the only storage, and an event on no track has none. Their building strings
still become catalog rows, so nothing is lost from the tournament's point of
view, but the event itself comes back unplaced.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8fc25a50dcbc'
down_revision: Union[str, None] = '6a3b32e96e8c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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
    op.create_foreign_key('fk_event_track_building', 'tournament_event_tracks', 'tournament_building_tracks', ['building_id', 'track_id'], ['building_id', 'track_id'], ondelete='RESTRICT')


def downgrade() -> None:
    # The buildings and tags created by the backfill are deliberately left
    # behind: once a TD has edited the catalog there is no way to tell a
    # generated row from one they added, and tournament_events still carries
    # its own building/room/floor at this revision, so nothing is lost by
    # keeping them.
    op.drop_constraint('fk_event_track_building', 'tournament_event_tracks', type_='foreignkey')
    op.drop_index(op.f('ix_tournament_event_tracks_building_id'), table_name='tournament_event_tracks')
    op.drop_column('tournament_event_tracks', 'rooms')
    op.drop_column('tournament_event_tracks', 'floor')
    op.drop_column('tournament_event_tracks', 'building_id')
