"""add_email_verified

Revision ID: f250cb93a643
Revises: 2e1dda44cde5
Create Date: 2026-06-28 22:31:08.365083

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f250cb93a643'
down_revision: str | None = '2e1dda44cde5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('email_verified', sa.Boolean(), nullable=False, server_default=sa.text('false')))


def downgrade() -> None:
    op.drop_column('users', 'email_verified')
