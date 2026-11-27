"""drop sheet_configs

Revision ID: c5d1e9a7f3b2
Revises: b8e2f4a61c3d
Create Date: 2026-11-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5d1e9a7f3b2"
down_revision: str | Sequence[str] | None = "b8e2f4a61c3d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index(op.f("ix_sheet_configs_id"), table_name="sheet_configs")
    op.drop_table("sheet_configs")


def downgrade() -> None:
    op.create_table(
        "sheet_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tournament_id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("sheet_type", sa.String(length=64), nullable=False),
        sa.Column("sheet_url", sa.Text(), nullable=False),
        sa.Column("spreadsheet_id", sa.String(length=255), nullable=False),
        sa.Column("sheet_name", sa.String(length=255), nullable=False),
        sa.Column("column_mappings", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sheet_configs_id"), "sheet_configs", ["id"], unique=False)
