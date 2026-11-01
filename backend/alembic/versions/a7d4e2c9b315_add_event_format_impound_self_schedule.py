"""add format, has_impound and has_self_schedule to season and tournament events

Revision ID: a7d4e2c9b315
Revises: fc57ee38d581
Create Date: 2026-10-31

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7d4e2c9b315"
down_revision: str | None = "fc57ee38d581"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("season_events", "tournament_events")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("format", sa.String(length=16), nullable=True))
        op.add_column(
            table,
            sa.Column("has_impound", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.add_column(
            table,
            sa.Column("has_self_schedule", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    for table in TABLES:
        op.drop_column(table, "has_self_schedule")
        op.drop_column(table, "has_impound")
        op.drop_column(table, "format")
