"""add display_config to users

Revision ID: d3f8a1c6e204
Revises: c4a9e7d2b815
Create Date: 2026-11-21

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3f8a1c6e204"
down_revision: str | Sequence[str] | None = "c4a9e7d2b815"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "display_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "display_config")
