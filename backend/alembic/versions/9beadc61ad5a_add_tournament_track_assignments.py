"""add tournament track assignments

The first revision for issue #83. Separate from the event-logistics
revision it chains off: that one is #81, and the two are different
features that happen to share a branch.

This revision only creates the table. Moving the existing roles and
assignments onto it, and dropping the three tables it replaces, is the
next revision — so this one can be applied and verified on its own.

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
    op.create_index('uq_track_assignment_event', 'tournament_track_assignments', ['membership_id', 'role_id', 'tournament_event_id'], unique=True, postgresql_where=sa.text('tournament_event_id IS NOT NULL AND tournament_shift_id IS NULL'))
    op.create_index('uq_track_assignment_event_shift', 'tournament_track_assignments', ['membership_id', 'role_id', 'tournament_event_id', 'tournament_shift_id'], unique=True, postgresql_where=sa.text('tournament_shift_id IS NOT NULL'))
    op.create_index('uq_track_assignment_grant', 'tournament_track_assignments', ['membership_id', 'role_id', 'tournament_track_id'], unique=True, postgresql_where=sa.text('NOT is_tournament_wide AND tournament_event_id IS NULL AND zone_id IS NULL'))
    op.create_index('uq_track_assignment_wide', 'tournament_track_assignments', ['membership_id', 'role_id'], unique=True, postgresql_where=sa.text('is_tournament_wide'))
    op.create_index('uq_track_assignment_zone', 'tournament_track_assignments', ['membership_id', 'role_id', 'zone_id'], unique=True, postgresql_where=sa.text('zone_id IS NOT NULL'))


def downgrade() -> None:
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
