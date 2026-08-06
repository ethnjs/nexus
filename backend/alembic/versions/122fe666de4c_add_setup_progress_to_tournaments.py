"""add setup_progress to tournaments

Revision ID: 122fe666de4c
Revises: faa21d1f5a4a
Create Date: 2026-08-06 13:14:37.100335

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '122fe666de4c'
down_revision: Union[str, None] = 'faa21d1f5a4a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default backfills existing rows so the NOT NULL add doesn't fail
    # against a non-empty table; SQLAlchemy's Python-side default=dict only
    # applies to new ORM inserts, not existing rows.
    op.add_column(
        'tournaments',
        sa.Column('setup_progress', sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )
    op.alter_column('tournaments', 'setup_progress', server_default=None)


def downgrade() -> None:
    op.drop_column('tournaments', 'setup_progress')
