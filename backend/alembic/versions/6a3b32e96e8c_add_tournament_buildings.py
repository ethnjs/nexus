"""add tournament buildings

Revision ID: 6a3b32e96e8c
Revises: d3b71a4c9e02
Create Date: 2026-09-15 14:35:01.345747

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
    # target: an event's location names both, so a later composite FK against
    # it is what stops a Day 1 event being placed in a Day 2-only building.
    op.create_table('tournament_building_tracks',
    sa.Column('building_id', sa.Integer(), nullable=False),
    sa.Column('track_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['building_id'], ['tournament_buildings.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['track_id'], ['tournament_tracks.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('building_id', 'track_id')
    )


def downgrade() -> None:
    op.drop_table('tournament_building_tracks')
    op.drop_index(op.f('ix_tournament_buildings_tournament_id'), table_name='tournament_buildings')
    op.drop_index(op.f('ix_tournament_buildings_id'), table_name='tournament_buildings')
    op.drop_table('tournament_buildings')
