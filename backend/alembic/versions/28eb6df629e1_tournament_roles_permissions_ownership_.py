"""tournament roles permissions ownership rebuild

Revision ID: 28eb6df629e1
Revises: 2cc03b477680
Create Date: 2026-08-01 10:38:46.276164

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '28eb6df629e1'
down_revision: Union[str, None] = '2cc03b477680'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('tournament_roles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=False),
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=False),
    sa.Column('permissions', sa.JSON(), nullable=False),
    sa.Column('rank', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tournament_id', 'key', name='uq_tournament_role_key')
    )
    op.create_index(op.f('ix_tournament_roles_id'), 'tournament_roles', ['id'], unique=False)

    op.create_table('tournament_membership_roles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('membership_id', sa.Integer(), nullable=False),
    sa.Column('role_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['membership_id'], ['tournament_memberships.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['role_id'], ['tournament_roles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('membership_id', 'role_id', name='uq_membership_role')
    )
    op.create_index(op.f('ix_tournament_membership_roles_id'), 'tournament_membership_roles', ['id'], unique=False)

    op.create_table('tournament_join_codes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=False),
    sa.Column('code', sa.String(length=8), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('use_count', sa.Integer(), nullable=False, server_default='0'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code')
    )

    op.add_column('tournaments', sa.Column('is_public', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('tournaments', sa.Column('is_verified', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('tournaments', sa.Column('registration_opens_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('tournaments', 'registration_opens_at')
    op.drop_column('tournaments', 'is_verified')
    op.drop_column('tournaments', 'is_public')

    op.drop_table('tournament_join_codes')

    op.drop_index(op.f('ix_tournament_membership_roles_id'), table_name='tournament_membership_roles')
    op.drop_table('tournament_membership_roles')

    op.drop_index(op.f('ix_tournament_roles_id'), table_name='tournament_roles')
    op.drop_table('tournament_roles')
