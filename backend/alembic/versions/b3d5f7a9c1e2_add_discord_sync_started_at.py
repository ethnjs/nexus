"""add discord sync started at

Revision ID: b3d5f7a9c1e2
Revises: 7a8a9668870e
Create Date: 2026-10-18 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3d5f7a9c1e2"
down_revision: str | Sequence[str] | None = "7a8a9668870e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "discord_guild_links",
        sa.Column("sync_started_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("discord_guild_links", "sync_started_at")
