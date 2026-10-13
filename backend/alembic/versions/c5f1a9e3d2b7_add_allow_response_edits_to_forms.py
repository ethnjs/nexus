"""add allow_response_edits to forms

Revision ID: c5f1a9e3d2b7
Revises: b4e8d2f1a7c3
Create Date: 2026-10-02 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5f1a9e3d2b7"
down_revision: str | None = "b4e8d2f1a7c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # server_default so the NOT NULL holds against existing rows; every
    # existing form starts with edits off, same as before this column.
    op.add_column(
        "forms",
        sa.Column("allow_response_edits", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("forms", "allow_response_edits")
