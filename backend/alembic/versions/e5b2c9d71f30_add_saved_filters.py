"""add saved_filters

Revision ID: e5b2c9d71f30
Revises: d3f8a1c6e204
Create Date: 2026-11-23

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5b2c9d71f30"
down_revision: str | Sequence[str] | None = "d3f8a1c6e204"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_filters",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("tournament_id", sa.Integer(), nullable=True),
        sa.Column("surface", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("filter", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "tournament_id",
            "surface",
            "name",
            name="uq_saved_filter_name",
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_index(op.f("ix_saved_filters_id"), "saved_filters", ["id"], unique=False)
    op.create_index(op.f("ix_saved_filters_user_id"), "saved_filters", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_saved_filters_tournament_id"), "saved_filters", ["tournament_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_saved_filters_tournament_id"), table_name="saved_filters")
    op.drop_index(op.f("ix_saved_filters_user_id"), table_name="saved_filters")
    op.drop_index(op.f("ix_saved_filters_id"), table_name="saved_filters")
    op.drop_table("saved_filters")
