"""add short_name to tournament_buildings

Revision ID: a3c51e7d2b90
Revises: 6beb17fe3470
Create Date: 2026-11-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3c51e7d2b90"
down_revision: str | None = "6beb17fe3470"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tournament_buildings", sa.Column("short_name", sa.String(length=64), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("tournament_buildings", "short_name")
