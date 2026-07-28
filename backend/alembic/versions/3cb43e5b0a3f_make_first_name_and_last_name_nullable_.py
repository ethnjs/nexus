"""make first_name and last_name nullable again

Revision ID: 3cb43e5b0a3f
Revises: d10cb65643a2
Create Date: 2026-07-28 16:04:44.299156

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3cb43e5b0a3f'
down_revision: Union[str, None] = 'd10cb65643a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('users', 'first_name',
               existing_type=sa.VARCHAR(length=100),
               nullable=True)
    op.alter_column('users', 'last_name',
               existing_type=sa.VARCHAR(length=100),
               nullable=True)


def downgrade() -> None:
    op.alter_column('users', 'last_name',
               existing_type=sa.VARCHAR(length=100),
               nullable=False)
    op.alter_column('users', 'first_name',
               existing_type=sa.VARCHAR(length=100),
               nullable=False)
