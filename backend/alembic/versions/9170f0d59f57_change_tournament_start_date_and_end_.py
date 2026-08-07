"""change tournament start_date and end_date to date-only

Revision ID: 9170f0d59f57
Revises: 8211291cc4d1
Create Date: 2026-08-06 21:20:36.125202

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '9170f0d59f57'
down_revision: Union[str, None] = '8211291cc4d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('tournaments', 'start_date',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               type_=sa.Date(),
               existing_nullable=False,
               postgresql_using='start_date::date')
    op.alter_column('tournaments', 'end_date',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               type_=sa.Date(),
               existing_nullable=False,
               postgresql_using='end_date::date')


def downgrade() -> None:
    op.alter_column('tournaments', 'end_date',
               existing_type=sa.Date(),
               type_=postgresql.TIMESTAMP(timezone=True),
               existing_nullable=False)
    op.alter_column('tournaments', 'start_date',
               existing_type=sa.Date(),
               type_=postgresql.TIMESTAMP(timezone=True),
               existing_nullable=False)
