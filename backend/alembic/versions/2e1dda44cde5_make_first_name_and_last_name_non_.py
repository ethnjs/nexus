"""make first_name and last_name non-nullable

Revision ID: 2e1dda44cde5
Revises: ef714fead897
Create Date: 2026-06-25 17:05:03.706013

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '2e1dda44cde5'
down_revision: Union[str, None] = 'ef714fead897'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('users', 'first_name',
               existing_type=sa.VARCHAR(length=100),
               nullable=False)
    op.alter_column('users', 'last_name',
               existing_type=sa.VARCHAR(length=100),
               nullable=False)


def downgrade() -> None:
    op.alter_column('users', 'last_name',
               existing_type=sa.VARCHAR(length=100),
               nullable=True)
    op.alter_column('users', 'first_name',
               existing_type=sa.VARCHAR(length=100),
               nullable=True)