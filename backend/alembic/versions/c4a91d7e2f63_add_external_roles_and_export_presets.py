"""add external roles and tournament_export_presets

Revision ID: c4a91d7e2f63
Revises: 8a438a1a14a3
Create Date: 2026-10-12

Exports (#108, #110):
- tournament_roles.torus_role / duosmium_role: what each role maps to in
  TORUS and Duosmium. Nullable with no default, so every role starts unmapped.
- tournament_export_presets: saved custom exports, shared per tournament.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4a91d7e2f63"
down_revision: str | None = "8a438a1a14a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tournament_roles", sa.Column("torus_role", sa.String(length=32), nullable=True))
    op.add_column(
        "tournament_roles", sa.Column("duosmium_role", sa.String(length=32), nullable=True)
    )

    op.create_table(
        "tournament_export_presets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tournament_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("row_type", sa.String(length=16), nullable=False),
        sa.Column("columns", sa.JSON(), nullable=False),
        sa.Column("member_filters", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("event_filters", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("sorts", sa.JSON(), nullable=False),
        sa.Column("include_header", sa.Boolean(), nullable=False),
        sa.Column("output_type", sa.String(length=8), nullable=False, server_default="copy"),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", "name", name="uq_tournament_export_preset_name"),
    )
    op.create_index(op.f("ix_tournament_export_presets_id"), "tournament_export_presets", ["id"])
    op.create_index(
        op.f("ix_tournament_export_presets_tournament_id"),
        "tournament_export_presets",
        ["tournament_id"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_tournament_export_presets_tournament_id"), table_name="tournament_export_presets"
    )
    op.drop_index(op.f("ix_tournament_export_presets_id"), table_name="tournament_export_presets")
    op.drop_table("tournament_export_presets")

    op.drop_column("tournament_roles", "duosmium_role")
    op.drop_column("tournament_roles", "torus_role")
