"""add default role to tournament tracks

Revision ID: c018f2ae8e71
Revises: b570994db077
Create Date: 2026-09-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c018f2ae8e71'
down_revision: Union[str, None] = 'b570994db077'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tournament_tracks', sa.Column('default_role_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_tournament_tracks_default_role_id', 'tournament_tracks', 'tournament_roles',
        ['default_role_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_tournament_tracks_default_role_id', 'tournament_tracks', type_='foreignkey')
    op.drop_column('tournament_tracks', 'default_role_id')
