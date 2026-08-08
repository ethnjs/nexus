"""add is_archived to tournaments

Revision ID: a4f2d8e91b3c
Revises: 9170f0d59f57
Create Date: 2026-08-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a4f2d8e91b3c'
down_revision: Union[str, None] = '9170f0d59f57'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tournaments', sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column('tournaments', 'is_archived', server_default=None)


def downgrade() -> None:
    op.drop_column('tournaments', 'is_archived')
