"""add short_name, state, level, division to tournaments; require dates

Revision ID: 8211291cc4d1
Revises: 8226e1d280b0
Create Date: 2026-08-06 19:00:24.577446

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '8211291cc4d1'
down_revision: Union[str, None] = '8226e1d280b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tournaments', sa.Column('short_name', sa.String(length=64), nullable=True))
    op.add_column('tournaments', sa.Column('state', sa.String(length=32), nullable=False))
    op.add_column('tournaments', sa.Column('level', sa.String(length=32), nullable=False))
    op.add_column('tournaments', sa.Column('division', sa.JSON(), nullable=False))
    op.alter_column('tournaments', 'start_date',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               nullable=False)
    op.alter_column('tournaments', 'end_date',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               nullable=False)


def downgrade() -> None:
    op.alter_column('tournaments', 'end_date',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               nullable=True)
    op.alter_column('tournaments', 'start_date',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               nullable=True)
    op.drop_column('tournaments', 'division')
    op.drop_column('tournaments', 'level')
    op.drop_column('tournaments', 'state')
    op.drop_column('tournaments', 'short_name')
