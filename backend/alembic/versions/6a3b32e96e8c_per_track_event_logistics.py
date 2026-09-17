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

    # -----------------------------------------------------------------------
    # The event's own location and staffing columns go, now that the backfill
    # above has moved everything worth keeping.
    #
    # volunteers_needed is dropped rather than migrated: it names no role, and
    # a staffing need has to. There is nothing to file the old number under,
    # so TDs re-enter staffing as per-role lines. This is the one lossy part
    # of this revision, and the downgrade cannot bring it back.
    # -----------------------------------------------------------------------
    op.drop_column('tournament_events', 'building')
    op.drop_column('tournament_events', 'room')
    op.drop_column('tournament_events', 'floor')
    op.drop_column('tournament_events', 'volunteers_needed')

    # -----------------------------------------------------------------------
    # Per-role staffing needs, replacing the number just dropped.
    #
    # Keyed on the event<->track link rather than on the event, so the
    # composite FK makes a need for a track the event doesn't run on
    # unrepresentable, and dropping the link takes its needs with it.
    # -----------------------------------------------------------------------
    op.create_table('tournament_event_staffing_needs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_event_id', sa.Integer(), nullable=False),
    sa.Column('track_id', sa.Integer(), nullable=False),
    sa.Column('role_id', sa.Integer(), nullable=False),
    sa.Column('count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('count >= 1', name='ck_staffing_need_count_positive'),
    sa.ForeignKeyConstraint(['role_id'], ['tournament_roles.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_event_id', 'track_id'], ['tournament_event_tracks.tournament_event_id', 'tournament_event_tracks.track_id'], name='fk_staffing_need_event_track', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tournament_event_id', 'track_id', 'role_id', name='uq_staffing_need_event_track_role')
    )
    op.create_index(op.f('ix_tournament_event_staffing_needs_id'), 'tournament_event_staffing_needs', ['id'], unique=False)
    op.create_index(op.f('ix_tournament_event_staffing_needs_role_id'), 'tournament_event_staffing_needs', ['role_id'], unique=False)
    op.create_index(op.f('ix_tournament_event_staffing_needs_tournament_event_id'), 'tournament_event_staffing_needs', ['tournament_event_id'], unique=False)
    op.create_index(op.f('ix_tournament_event_staffing_needs_track_id'), 'tournament_event_staffing_needs', ['track_id'], unique=False)

    # -----------------------------------------------------------------------
    # Zones
    #
    # A zone stores rules, not events — see core/tournament/zones.py. The
    # constraints here are what make that safe: the partial unique indexes
    # below mean at most one zone per track can claim a given building, floor
    # or event, so the precedence rule always has exactly one answer.
    # -----------------------------------------------------------------------

    # Must come first: tournament_zones carries a composite FK against it, and
    # Postgres requires the referenced unique index to exist beforehand.
    op.create_unique_constraint('uq_tournament_track_id_tournament', 'tournament_tracks', ['id', 'tournament_id'])

    op.create_table('tournament_zones',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=False),
    sa.Column('track_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('default_role_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['default_role_id'], ['tournament_roles.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['track_id', 'tournament_id'], ['tournament_tracks.id', 'tournament_tracks.tournament_id'], name='fk_zone_track_tournament', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('id', 'track_id', name='uq_tournament_zone_id_track'),
    sa.UniqueConstraint('track_id', 'name', name='uq_tournament_zone_name')
    )
    op.create_index(op.f('ix_tournament_zones_id'), 'tournament_zones', ['id'], unique=False)
    op.create_index(op.f('ix_tournament_zones_tournament_id'), 'tournament_zones', ['tournament_id'], unique=False)
    op.create_index(op.f('ix_tournament_zones_track_id'), 'tournament_zones', ['track_id'], unique=False)

    op.create_table('tournament_zone_members',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('zone_id', sa.Integer(), nullable=False),
    sa.Column('track_id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('building_id', sa.Integer(), nullable=True),
    sa.Column('floor', sa.String(length=64), nullable=True),
    sa.Column('tournament_event_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint(
        "(kind = 'building' AND building_id IS NOT NULL AND floor IS NULL "
        "  AND tournament_event_id IS NULL) OR "
        "(kind = 'floor' AND building_id IS NOT NULL AND floor IS NOT NULL "
        "  AND tournament_event_id IS NULL) OR "
        "(kind = 'event' AND tournament_event_id IS NOT NULL AND building_id IS NULL "
        "  AND floor IS NULL)",
        name='ck_zone_member_shape'),
    sa.ForeignKeyConstraint(['building_id', 'track_id'], ['tournament_building_tracks.building_id', 'tournament_building_tracks.track_id'], name='fk_zone_member_building', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_event_id', 'track_id'], ['tournament_event_tracks.tournament_event_id', 'tournament_event_tracks.track_id'], name='fk_zone_member_event', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['zone_id', 'track_id'], ['tournament_zones.id', 'tournament_zones.track_id'], name='fk_zone_member_zone', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tournament_zone_members_building_id'), 'tournament_zone_members', ['building_id'], unique=False)
    op.create_index(op.f('ix_tournament_zone_members_id'), 'tournament_zone_members', ['id'], unique=False)
    op.create_index(op.f('ix_tournament_zone_members_tournament_event_id'), 'tournament_zone_members', ['tournament_event_id'], unique=False)
    op.create_index(op.f('ix_tournament_zone_members_track_id'), 'tournament_zone_members', ['track_id'], unique=False)
    op.create_index(op.f('ix_tournament_zone_members_zone_id'), 'tournament_zone_members', ['zone_id'], unique=False)
    # One zone per thing per track. Partial, because each kind uses different
    # columns and a NULL in a plain unique index would let duplicates through.
    op.create_index('uq_zone_member_building', 'tournament_zone_members', ['track_id', 'building_id'], unique=True, postgresql_where=sa.text("kind = 'building'"))
    op.create_index('uq_zone_member_floor', 'tournament_zone_members', ['track_id', 'building_id', 'floor'], unique=True, postgresql_where=sa.text("kind = 'floor'"))
    op.create_index('uq_zone_member_event', 'tournament_zone_members', ['track_id', 'tournament_event_id'], unique=True, postgresql_where=sa.text("kind = 'event'"))

    op.create_table('tournament_zone_assignments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('zone_id', sa.Integer(), nullable=False),
    sa.Column('membership_id', sa.Integer(), nullable=False),
    sa.Column('membership_role_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['membership_id'], ['tournament_memberships.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['membership_role_id', 'membership_id'], ['tournament_membership_roles.id', 'tournament_membership_roles.membership_id'], name='fk_zone_assignment_membership_role', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['zone_id'], ['tournament_zones.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('zone_id', 'membership_id', 'membership_role_id', name='uq_zone_assignment')
    )
    op.create_index(op.f('ix_tournament_zone_assignments_id'), 'tournament_zone_assignments', ['id'], unique=False)
    op.create_index(op.f('ix_tournament_zone_assignments_membership_id'), 'tournament_zone_assignments', ['membership_id'], unique=False)
    op.create_index(op.f('ix_tournament_zone_assignments_membership_role_id'), 'tournament_zone_assignments', ['membership_role_id'], unique=False)
    op.create_index(op.f('ix_tournament_zone_assignments_zone_id'), 'tournament_zone_assignments', ['zone_id'], unique=False)

    # -----------------------------------------------------------------------
    # Saved display configs follow the surfaces that just changed shape.
    #
    # Two edits, both on tournament_memberships.display_config:
    #
    #   1. The assignments board is tabbed per track now, so its two surfaces
    #      became a family of keys ("assignments_events:all",
    #      "assignments_events:track:3", ...). An existing blob is what that
    #      TD configured while the board showed every track at once, which is
    #      exactly the All tab — so it moves there rather than being dropped.
    #      The per-track tabs start at defaults, which is right: nobody has
    #      ever configured them.
    #
    #   2. The events table lost its four location/staffing columns, so any
    #      saved column list naming them is pruned. Left in place they would
    #      be silently ignored on read, but would come back on the next PUT
    #      as a 422 the TD did nothing to cause.
    #
    # Cast through jsonb both ways: the column is `json`, which has neither
    # the `-` operator nor jsonb_set.
    # -----------------------------------------------------------------------
    op.execute(sa.text("""
        UPDATE tournament_memberships SET display_config = (
            (display_config::jsonb - 'assignments_events' - 'assignment_card')
            || CASE WHEN jsonb_exists(display_config::jsonb, 'assignments_events')
                    THEN jsonb_build_object('assignments_events:all',
                                            display_config::jsonb -> 'assignments_events')
                    ELSE '{}'::jsonb END
            || CASE WHEN jsonb_exists(display_config::jsonb, 'assignment_card')
                    THEN jsonb_build_object('assignment_card:all',
                                            display_config::jsonb -> 'assignment_card')
                    ELSE '{}'::jsonb END
        )::json
        WHERE display_config IS NOT NULL
          AND jsonb_typeof(display_config::jsonb) = 'object'
          AND (jsonb_exists(display_config::jsonb, 'assignments_events')
               OR jsonb_exists(display_config::jsonb, 'assignment_card'))
    """))

    op.execute(sa.text("""
        UPDATE tournament_memberships SET display_config = jsonb_set(
            display_config::jsonb,
            '{events_table,columns}',
            (SELECT COALESCE(jsonb_agg(c), '[]'::jsonb)
               FROM jsonb_array_elements_text(
                        display_config::jsonb #> '{events_table,columns}') AS c
              WHERE c NOT IN ('building', 'room', 'floor', 'volunteers_needed'))
        )::json
        WHERE display_config IS NOT NULL
          AND jsonb_typeof(display_config::jsonb #> '{events_table,columns}') = 'array'
    """))


def downgrade() -> None:
    # The All tab's config goes back under the bare key. Per-track tabs are
    # dropped — the un-tabbed board has nowhere to put them, and they were
    # never configured before this revision.
    op.execute(sa.text("""
        UPDATE tournament_memberships SET display_config = (
            (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
               FROM jsonb_each(display_config::jsonb) AS e(k, v)
              WHERE split_part(k, ':', 1) NOT IN ('assignments_events', 'assignment_card'))
            || CASE WHEN jsonb_exists(display_config::jsonb, 'assignments_events:all')
                    THEN jsonb_build_object('assignments_events',
                                            display_config::jsonb -> 'assignments_events:all')
                    ELSE '{}'::jsonb END
            || CASE WHEN jsonb_exists(display_config::jsonb, 'assignment_card:all')
                    THEN jsonb_build_object('assignment_card',
                                            display_config::jsonb -> 'assignment_card:all')
                    ELSE '{}'::jsonb END
        )::json
        WHERE display_config IS NOT NULL
          AND jsonb_typeof(display_config::jsonb) = 'object'
    """))

    op.drop_table('tournament_zone_assignments')
    op.drop_index('uq_zone_member_event', table_name='tournament_zone_members', postgresql_where=sa.text("kind = 'event'"))
    op.drop_index('uq_zone_member_floor', table_name='tournament_zone_members', postgresql_where=sa.text("kind = 'floor'"))
    op.drop_index('uq_zone_member_building', table_name='tournament_zone_members', postgresql_where=sa.text("kind = 'building'"))
    op.drop_table('tournament_zone_members')
    op.drop_table('tournament_zones')
    # Last of the zone teardown: the composite FK above depended on it.
    op.drop_constraint('uq_tournament_track_id_tournament', 'tournament_tracks', type_='unique')

    op.drop_index(op.f('ix_tournament_event_staffing_needs_track_id'), table_name='tournament_event_staffing_needs')
    op.drop_index(op.f('ix_tournament_event_staffing_needs_tournament_event_id'), table_name='tournament_event_staffing_needs')
    op.drop_index(op.f('ix_tournament_event_staffing_needs_role_id'), table_name='tournament_event_staffing_needs')
    op.drop_index(op.f('ix_tournament_event_staffing_needs_id'), table_name='tournament_event_staffing_needs')
    op.drop_table('tournament_event_staffing_needs')

    # The columns come back empty. The location could in principle be read
    # back off the link rows, but only for an event on exactly one track —
    # which is precisely the case this revision exists to stop pretending is
    # the only one — so nothing is restored rather than restoring a lie.
    op.add_column('tournament_events', sa.Column('building', sa.String(length=255), nullable=True))
    op.add_column('tournament_events', sa.Column('room', sa.String(length=64), nullable=True))
    op.add_column('tournament_events', sa.Column('floor', sa.String(length=64), nullable=True))
    op.add_column('tournament_events', sa.Column('volunteers_needed', sa.Integer(), nullable=True))

    op.drop_constraint('fk_event_track_building', 'tournament_event_tracks', type_='foreignkey')
    op.drop_index(op.f('ix_tournament_event_tracks_building_id'), table_name='tournament_event_tracks')
    op.drop_column('tournament_event_tracks', 'rooms')
    op.drop_column('tournament_event_tracks', 'floor')
    op.drop_column('tournament_event_tracks', 'building_id')

    op.drop_table('tournament_building_tracks')
    op.drop_index(op.f('ix_tournament_buildings_tournament_id'), table_name='tournament_buildings')
    op.drop_index(op.f('ix_tournament_buildings_id'), table_name='tournament_buildings')
    op.drop_table('tournament_buildings')
