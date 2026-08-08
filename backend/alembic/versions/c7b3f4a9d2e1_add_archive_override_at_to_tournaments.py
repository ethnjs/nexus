"""add archive_override_at to tournaments

Revision ID: c7b3f4a9d2e1
Revises: a4f2d8e91b3c
Create Date: 2026-08-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c7b3f4a9d2e1'
down_revision: Union[str, None] = 'a4f2d8e91b3c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tournaments', sa.Column('archive_override_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('tournaments', 'archive_override_at')
