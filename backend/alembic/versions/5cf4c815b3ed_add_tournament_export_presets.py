"""add tournament_export_presets

Revision ID: 5cf4c815b3ed
Revises: 524b8bcd655f
Create Date: 2026-10-09

Saved custom exports (#110), shared per tournament. New table only; nothing
existing changes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '5cf4c815b3ed'
down_revision: Union[str, None] = '524b8bcd655f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tournament_export_presets',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tournament_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('row_type', sa.String(length=16), nullable=False),
        sa.Column('columns', sa.JSON(), nullable=False),
        sa.Column('member_filters', sa.JSON(), nullable=False),
        sa.Column('event_filters', sa.JSON(), nullable=False),
        sa.Column('sorts', sa.JSON(), nullable=False),
        sa.Column('include_header', sa.Boolean(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tournament_id', 'name', name='uq_tournament_export_preset_name'),
    )
    op.create_index(op.f('ix_tournament_export_presets_id'), 'tournament_export_presets', ['id'])
    op.create_index(
        op.f('ix_tournament_export_presets_tournament_id'), 'tournament_export_presets', ['tournament_id'],
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_tournament_export_presets_tournament_id'), table_name='tournament_export_presets')
    op.drop_index(op.f('ix_tournament_export_presets_id'), table_name='tournament_export_presets')
    op.drop_table('tournament_export_presets')
