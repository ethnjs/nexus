"""add tournament event assignments

Revision ID: b570994db077
Revises: eb2e5d683865
Create Date: 2026-09-08 14:00:53.232596

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b570994db077'
down_revision: Union[str, None] = 'eb2e5d683865'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Must come first: the assignments table's composite FK references this
    # constraint, and Postgres requires the referenced unique index to exist
    # before the FK is created. Autogenerate emitted it last.
    op.create_unique_constraint('uq_membership_role_id_membership', 'tournament_membership_roles', ['id', 'membership_id'])

    op.create_table('tournament_event_assignments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_event_id', sa.Integer(), nullable=False),
    sa.Column('membership_id', sa.Integer(), nullable=False),
    sa.Column('membership_role_id', sa.Integer(), nullable=False),
    sa.Column('tournament_shift_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['membership_id'], ['tournament_memberships.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['membership_role_id', 'membership_id'], ['tournament_membership_roles.id', 'tournament_membership_roles.membership_id'], name='fk_assignment_membership_role', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_event_id'], ['tournament_events.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_shift_id'], ['tournament_shifts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tournament_event_assignments_id'), 'tournament_event_assignments', ['id'], unique=False)
    op.create_index(op.f('ix_tournament_event_assignments_membership_id'), 'tournament_event_assignments', ['membership_id'], unique=False)
    op.create_index(op.f('ix_tournament_event_assignments_membership_role_id'), 'tournament_event_assignments', ['membership_role_id'], unique=False)
    op.create_index(op.f('ix_tournament_event_assignments_tournament_event_id'), 'tournament_event_assignments', ['tournament_event_id'], unique=False)
    op.create_index(op.f('ix_tournament_event_assignments_tournament_shift_id'), 'tournament_event_assignments', ['tournament_shift_id'], unique=False)
    op.create_index('uq_event_assignment_no_shift', 'tournament_event_assignments', ['tournament_event_id', 'membership_role_id'], unique=True, postgresql_where=sa.text('tournament_shift_id IS NULL'))
    op.create_index('uq_event_assignment_with_shift', 'tournament_event_assignments', ['tournament_event_id', 'membership_role_id', 'tournament_shift_id'], unique=True, postgresql_where=sa.text('tournament_shift_id IS NOT NULL'))


def downgrade() -> None:
    op.drop_index('uq_event_assignment_with_shift', table_name='tournament_event_assignments', postgresql_where=sa.text('tournament_shift_id IS NOT NULL'))
    op.drop_index('uq_event_assignment_no_shift', table_name='tournament_event_assignments', postgresql_where=sa.text('tournament_shift_id IS NULL'))
    op.drop_index(op.f('ix_tournament_event_assignments_tournament_shift_id'), table_name='tournament_event_assignments')
    op.drop_index(op.f('ix_tournament_event_assignments_tournament_event_id'), table_name='tournament_event_assignments')
    op.drop_index(op.f('ix_tournament_event_assignments_membership_role_id'), table_name='tournament_event_assignments')
    op.drop_index(op.f('ix_tournament_event_assignments_membership_id'), table_name='tournament_event_assignments')
    op.drop_index(op.f('ix_tournament_event_assignments_id'), table_name='tournament_event_assignments')
    op.drop_table('tournament_event_assignments')

    # Last, mirroring the upgrade: the composite FK above depends on it, so it
    # can only go once the table carrying that FK is gone.
    op.drop_constraint('uq_membership_role_id_membership', 'tournament_membership_roles', type_='unique')
