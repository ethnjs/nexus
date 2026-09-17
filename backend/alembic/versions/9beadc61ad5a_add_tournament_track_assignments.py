"""add tournament track assignments

The first revision for issue #83. Separate from the event-logistics
revision it chains off: that one is #81, and the two are different
features that happen to share a branch.

Creates the table and moves the existing roles and assignments onto it.
The three tables it replaces are NOT dropped here — the routes still
write them until they are repointed, so dropping them now would leave
the tree broken between commits. That drop comes later in this same
revision.

Revision ID: 9beadc61ad5a
Revises: 6a3b32e96e8c
Create Date: 2026-09-17 00:39:16.922315

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9beadc61ad5a'
down_revision: Union[str, None] = '6a3b32e96e8c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('tournament_track_assignments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('membership_id', sa.Integer(), nullable=False),
    sa.Column('role_id', sa.Integer(), nullable=False),
    sa.Column('is_tournament_wide', sa.Boolean(), nullable=False),
    sa.Column('tournament_track_id', sa.Integer(), nullable=True),
    sa.Column('tournament_event_id', sa.Integer(), nullable=True),
    sa.Column('tournament_shift_id', sa.Integer(), nullable=True),
    sa.Column('zone_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('(is_tournament_wide AND tournament_track_id IS NULL   AND tournament_event_id IS NULL AND tournament_shift_id IS NULL   AND zone_id IS NULL) OR (NOT is_tournament_wide AND tournament_track_id IS NOT NULL)', name='ck_track_assignment_scope'),
    sa.CheckConstraint('tournament_event_id IS NULL OR zone_id IS NULL', name='ck_track_assignment_one_target'),
    sa.CheckConstraint('tournament_shift_id IS NULL OR tournament_event_id IS NOT NULL', name='ck_track_assignment_shift_needs_event'),
    sa.ForeignKeyConstraint(['membership_id'], ['tournament_memberships.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['role_id'], ['tournament_roles.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_event_id', 'tournament_track_id'], ['tournament_event_tracks.tournament_event_id', 'tournament_event_tracks.track_id'], name='fk_track_assignment_event', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_shift_id', 'tournament_track_id'], ['tournament_shifts.id', 'tournament_shifts.track_id'], name='fk_track_assignment_shift', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_track_id'], ['tournament_tracks.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['zone_id', 'tournament_track_id'], ['tournament_zones.id', 'tournament_zones.track_id'], name='fk_track_assignment_zone', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tournament_track_assignments_id'), 'tournament_track_assignments', ['id'], unique=False)
    op.create_index(op.f('ix_tournament_track_assignments_membership_id'), 'tournament_track_assignments', ['membership_id'], unique=False)
    op.create_index(op.f('ix_tournament_track_assignments_role_id'), 'tournament_track_assignments', ['role_id'], unique=False)
    op.create_index(op.f('ix_tournament_track_assignments_tournament_event_id'), 'tournament_track_assignments', ['tournament_event_id'], unique=False)
    op.create_index(op.f('ix_tournament_track_assignments_tournament_shift_id'), 'tournament_track_assignments', ['tournament_shift_id'], unique=False)
    op.create_index(op.f('ix_tournament_track_assignments_tournament_track_id'), 'tournament_track_assignments', ['tournament_track_id'], unique=False)
    op.create_index(op.f('ix_tournament_track_assignments_zone_id'), 'tournament_track_assignments', ['zone_id'], unique=False)
    op.create_index('uq_track_assignment_event', 'tournament_track_assignments', ['membership_id', 'role_id', 'tournament_event_id', 'tournament_track_id'], unique=True, postgresql_where=sa.text('tournament_event_id IS NOT NULL AND tournament_shift_id IS NULL'))
    op.create_index('uq_track_assignment_event_shift', 'tournament_track_assignments', ['membership_id', 'role_id', 'tournament_event_id', 'tournament_shift_id'], unique=True, postgresql_where=sa.text('tournament_shift_id IS NOT NULL'))
    op.create_index('uq_track_assignment_grant', 'tournament_track_assignments', ['membership_id', 'role_id', 'tournament_track_id'], unique=True, postgresql_where=sa.text('NOT is_tournament_wide AND tournament_event_id IS NULL AND zone_id IS NULL'))
    op.create_index('uq_track_assignment_wide', 'tournament_track_assignments', ['membership_id', 'role_id'], unique=True, postgresql_where=sa.text('is_tournament_wide'))
    op.create_index('uq_track_assignment_zone', 'tournament_track_assignments', ['membership_id', 'role_id', 'zone_id'], unique=True, postgresql_where=sa.text('zone_id IS NOT NULL'))

    # -----------------------------------------------------------------------
    # Backfill: roles and assignments move onto the new table.
    #
    # Nothing is dropped here. The three tables this replaces are still
    # written by the routes until those are repointed, so they stay until a
    # later step in this same revision.
    #
    # The order matters. Staffing rows go first, because the grant rows in
    # steps 4 and 5 are derived from which tracks those staffing rows landed
    # on — that is the "assignments first, else the earliest primary track"
    # rule from issue #83.
    # -----------------------------------------------------------------------

    # 0. Repair, before anything depends on it.
    #
    #    An event could end up holding a shift on a track it was not linked
    #    to: the events route only re-derives tracks from shifts when the
    #    write includes shift_ids, so a PATCH sending tracks alone could drop
    #    one that a shift still sat on. The new composite FK below makes a
    #    staffing row on such a pair unrepresentable, so those rows would
    #    fail to migrate — and the assignment is right, it is the missing
    #    link that is wrong. An event scheduled on a day plainly runs on it.
    op.execute("""
        INSERT INTO tournament_event_tracks (tournament_event_id, track_id)
        SELECT DISTINCT es.tournament_event_id, s.track_id
        FROM tournament_event_shifts es
        JOIN tournament_shifts s ON s.id = es.tournament_shift_id
        ON CONFLICT (tournament_event_id, track_id) DO NOTHING
    """)

    # What each member can do *before* the move, so step 6 can prove it
    # unchanged. Read from the old table while it is still the truth.
    op.execute("""
        CREATE TEMP TABLE _perm_before AS
        SELECT DISTINCT mr.membership_id,
               jsonb_array_elements_text(r.permissions::jsonb) AS perm
        FROM tournament_membership_roles mr
        JOIN tournament_roles r ON r.id = mr.role_id
        WHERE jsonb_typeof(r.permissions::jsonb) = 'array'
    """)

    # 1. Event staffing. The old row's membership_role names the role; its own
    #    tournament_track_id names the track, and the composite FK on the new
    #    table now makes those two agree by construction.
    op.execute("""
        INSERT INTO tournament_track_assignments
          (membership_id, role_id, is_tournament_wide, tournament_track_id,
           tournament_event_id, tournament_shift_id, zone_id, created_at, updated_at)
        SELECT a.membership_id, mr.role_id, FALSE, a.tournament_track_id,
               a.tournament_event_id, a.tournament_shift_id, NULL::integer,
               a.created_at, a.updated_at
        FROM tournament_event_assignments a
        JOIN tournament_membership_roles mr ON mr.id = a.membership_role_id
    """)

    # 2. Zone coverage. The track comes from the zone, which is where it
    #    always lived — a zone assignment never stored one of its own.
    op.execute("""
        INSERT INTO tournament_track_assignments
          (membership_id, role_id, is_tournament_wide, tournament_track_id,
           tournament_event_id, tournament_shift_id, zone_id, created_at, updated_at)
        SELECT za.membership_id, mr.role_id, FALSE, z.track_id,
               NULL::integer, NULL::integer, za.zone_id, za.created_at, za.updated_at
        FROM tournament_zone_assignments za
        JOIN tournament_membership_roles mr ON mr.id = za.membership_role_id
        JOIN tournament_zones z ON z.id = za.zone_id
    """)

    # 3. Roles that carry permissions become tournament-wide rather than
    #    landing on a day. A director's access must not be revocable by
    #    deleting the track their role happened to migrate onto — the FK
    #    cascades, and nothing would have said so.
    op.execute("""
        INSERT INTO tournament_track_assignments
          (membership_id, role_id, is_tournament_wide, tournament_track_id,
           tournament_event_id, tournament_shift_id, zone_id, created_at, updated_at)
        SELECT DISTINCT mr.membership_id, mr.role_id, TRUE, NULL::integer,
               NULL::integer, NULL::integer, NULL::integer, now(), now()
        FROM tournament_membership_roles mr
        JOIN tournament_roles r ON r.id = mr.role_id
        WHERE jsonb_typeof(r.permissions::jsonb) = 'array'
          AND jsonb_array_length(r.permissions::jsonb) > 0
    """)

    # 4. Every other role lands on each track its staffing already used. A
    #    grant row alongside the staffing row, not instead of it: the member
    #    held this role independently of any one event, and un-staffing them
    #    should not take the role with it.
    op.execute("""
        INSERT INTO tournament_track_assignments
          (membership_id, role_id, is_tournament_wide, tournament_track_id,
           tournament_event_id, tournament_shift_id, zone_id, created_at, updated_at)
        SELECT DISTINCT ta.membership_id, ta.role_id, FALSE, ta.tournament_track_id,
               NULL::integer, NULL::integer, NULL::integer, now(), now()
        FROM tournament_track_assignments ta
        JOIN tournament_roles r ON r.id = ta.role_id
        WHERE ta.tournament_track_id IS NOT NULL
          AND NOT (jsonb_typeof(r.permissions::jsonb) = 'array'
                   AND jsonb_array_length(r.permissions::jsonb) > 0)
          AND NOT EXISTS (
              SELECT 1 FROM tournament_track_assignments g
              WHERE g.membership_id = ta.membership_id
                AND g.role_id = ta.role_id
                AND g.tournament_track_id = ta.tournament_track_id
                AND g.tournament_event_id IS NULL
                AND g.zone_id IS NULL
                AND NOT g.is_tournament_wide
          )
    """)

    # 5. A role with no staffing behind it has nothing to derive a track from,
    #    so it goes to the earliest primary track. Cosmetic tracks are skipped
    #    — a role with no evidence belongs on a competition day, not on Test
    #    Writing. A tournament always has at least one live primary track
    #    (enforced by the tracks routes), so the lateral join always matches.
    op.execute("""
        INSERT INTO tournament_track_assignments
          (membership_id, role_id, is_tournament_wide, tournament_track_id,
           tournament_event_id, tournament_shift_id, zone_id, created_at, updated_at)
        SELECT mr.membership_id, mr.role_id, FALSE, earliest.id,
               NULL::integer, NULL::integer, NULL::integer, now(), now()
        FROM tournament_membership_roles mr
        JOIN tournament_memberships m ON m.id = mr.membership_id
        JOIN LATERAL (
            SELECT t.id FROM tournament_tracks t
            WHERE t.tournament_id = m.tournament_id
              AND t.is_primary AND NOT t.is_archived
            ORDER BY t.start_date NULLS LAST, t.id
            LIMIT 1
        ) earliest ON TRUE
        WHERE NOT EXISTS (
            SELECT 1 FROM tournament_track_assignments ta
            WHERE ta.membership_id = mr.membership_id AND ta.role_id = mr.role_id
        )
    """)

    # 6. Prove it. A role that failed to carry across is not a missing display
    #    field — it is a coordinator who can no longer manage members, or a
    #    director locked out of their own tournament. Cheap insurance against
    #    a join subtly wrong above, and completion criterion 1 on #83.
    op.execute("""
        CREATE TEMP TABLE _perm_after AS
        SELECT DISTINCT ta.membership_id,
               jsonb_array_elements_text(r.permissions::jsonb) AS perm
        FROM tournament_track_assignments ta
        JOIN tournament_roles r ON r.id = ta.role_id
        WHERE jsonb_typeof(r.permissions::jsonb) = 'array'
    """)
    op.execute("""
        DO $$
        DECLARE drifted int;
        BEGIN
            SELECT count(*) INTO drifted FROM (
                (SELECT membership_id, perm FROM _perm_before
                 EXCEPT SELECT membership_id, perm FROM _perm_after)
                UNION ALL
                (SELECT membership_id, perm FROM _perm_after
                 EXCEPT SELECT membership_id, perm FROM _perm_before)
            ) d;
            IF drifted > 0 THEN
                RAISE EXCEPTION
                    'track assignment backfill changed effective permissions for % member/permission pair(s)',
                    drifted;
            END IF;
        END $$
    """)

    # Every role a member held must still be held somewhere, permissions or
    # not — the check above only covers roles that grant something.
    op.execute("""
        DO $$
        DECLARE lost int;
        BEGIN
            SELECT count(*) INTO lost
            FROM tournament_membership_roles mr
            WHERE NOT EXISTS (
                SELECT 1 FROM tournament_track_assignments ta
                WHERE ta.membership_id = mr.membership_id AND ta.role_id = mr.role_id
            );
            IF lost > 0 THEN
                RAISE EXCEPTION
                    'track assignment backfill dropped % membership role(s)', lost;
            END IF;
        END $$
    """)

    op.execute("DROP TABLE _perm_before")
    op.execute("DROP TABLE _perm_after")

    # -----------------------------------------------------------------------
    # The three tables this one replaces. Dropped last, after every check
    # above has passed — nothing below this line can fail, so the assertions
    # are the last chance to abort with the old data still intact.
    # -----------------------------------------------------------------------
    op.drop_table('tournament_event_assignments')
    op.drop_table('tournament_zone_assignments')
    op.drop_table('tournament_membership_roles')


def downgrade() -> None:
    # The three tables come back empty. Moving the rows home would mean
    # splitting each track assignment back into a membership-role plus an
    # event or zone row, and choosing which of several tracks a single
    # tournament-wide role came from — a guess the upgrade deliberately
    # replaced with a rule. Downgrading is a development operation here.
    op.create_table('tournament_membership_roles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('membership_id', sa.Integer(), nullable=False),
    sa.Column('role_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['membership_id'], ['tournament_memberships.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['role_id'], ['tournament_roles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('id', 'membership_id', name='uq_membership_role_id_membership'),
    sa.UniqueConstraint('membership_id', 'role_id', name='uq_membership_role'),
    )
    op.create_index(op.f('ix_tournament_membership_roles_id'), 'tournament_membership_roles', ['id'], unique=False)

    op.create_table('tournament_event_assignments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_event_id', sa.Integer(), nullable=False),
    sa.Column('membership_id', sa.Integer(), nullable=False),
    sa.Column('membership_role_id', sa.Integer(), nullable=False),
    sa.Column('tournament_shift_id', sa.Integer(), nullable=True),
    sa.Column('tournament_track_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['membership_id'], ['tournament_memberships.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['membership_role_id', 'membership_id'], ['tournament_membership_roles.id', 'tournament_membership_roles.membership_id'], name='fk_assignment_membership_role', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_event_id'], ['tournament_events.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_shift_id', 'tournament_track_id'], ['tournament_shifts.id', 'tournament_shifts.track_id'], name='fk_assignment_shift_track', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_track_id'], ['tournament_tracks.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_tournament_event_assignments_id'), 'tournament_event_assignments', ['id'], unique=False)
    op.create_index('uq_event_assignment_no_shift', 'tournament_event_assignments', ['tournament_event_id', 'membership_role_id', 'tournament_track_id'], unique=True, postgresql_where=sa.text('tournament_shift_id IS NULL'))
    op.create_index('uq_event_assignment_with_shift', 'tournament_event_assignments', ['tournament_event_id', 'membership_role_id', 'tournament_shift_id'], unique=True, postgresql_where=sa.text('tournament_shift_id IS NOT NULL'))

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
    sa.UniqueConstraint('zone_id', 'membership_id', 'membership_role_id', name='uq_zone_assignment'),
    )
    op.create_index(op.f('ix_tournament_zone_assignments_id'), 'tournament_zone_assignments', ['id'], unique=False)

    op.drop_index('uq_track_assignment_zone', table_name='tournament_track_assignments', postgresql_where=sa.text('zone_id IS NOT NULL'))
    op.drop_index('uq_track_assignment_wide', table_name='tournament_track_assignments', postgresql_where=sa.text('is_tournament_wide'))
    op.drop_index('uq_track_assignment_grant', table_name='tournament_track_assignments', postgresql_where=sa.text('NOT is_tournament_wide AND tournament_event_id IS NULL AND zone_id IS NULL'))
    op.drop_index('uq_track_assignment_event_shift', table_name='tournament_track_assignments', postgresql_where=sa.text('tournament_shift_id IS NOT NULL'))
    op.drop_index('uq_track_assignment_event', table_name='tournament_track_assignments', postgresql_where=sa.text('tournament_event_id IS NOT NULL AND tournament_shift_id IS NULL'))
    op.drop_index(op.f('ix_tournament_track_assignments_zone_id'), table_name='tournament_track_assignments')
    op.drop_index(op.f('ix_tournament_track_assignments_tournament_track_id'), table_name='tournament_track_assignments')
    op.drop_index(op.f('ix_tournament_track_assignments_tournament_shift_id'), table_name='tournament_track_assignments')
    op.drop_index(op.f('ix_tournament_track_assignments_tournament_event_id'), table_name='tournament_track_assignments')
    op.drop_index(op.f('ix_tournament_track_assignments_role_id'), table_name='tournament_track_assignments')
    op.drop_index(op.f('ix_tournament_track_assignments_membership_id'), table_name='tournament_track_assignments')
    op.drop_index(op.f('ix_tournament_track_assignments_id'), table_name='tournament_track_assignments')
    op.drop_table('tournament_track_assignments')
