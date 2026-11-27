"""add discord sync warning

Revision ID: 7a8a9668870e
Revises: f29638d2f50e
Create Date: 2026-10-17 20:44:58.535828

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7a8a9668870e"
down_revision: str | Sequence[str] | None = "f29638d2f50e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("discord_guild_links", sa.Column("last_sync_warning", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("discord_guild_links", "last_sync_warning")
