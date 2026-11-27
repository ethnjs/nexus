"""add discord tables

Revision ID: f29638d2f50e
Revises: 61957c8fe811
Create Date: 2026-10-16 02:36:35.228578

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f29638d2f50e"
down_revision: str | Sequence[str] | None = "61957c8fe811"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "discord_guild_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tournament_id", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("guild_id", sa.BigInteger(), nullable=False),
        sa.Column("guild_name", sa.String(length=100), nullable=True),
        sa.Column("installed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("merge_divisions", sa.Boolean(), nullable=False),
        sa.Column("category_grouping", sa.String(length=16), nullable=False),
        sa.Column("built_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("bot_removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_build_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_build_status", sa.String(length=16), nullable=True),
        sa.Column("last_build_error", sa.Text(), nullable=True),
        sa.Column("last_sync_error", sa.Text(), nullable=True),
        sa.Column("verified_role_id", sa.BigInteger(), nullable=True),
        sa.Column("owner_role_id", sa.BigInteger(), nullable=True),
        sa.Column("verify_channel_id", sa.BigInteger(), nullable=True),
        sa.Column("verify_message_id", sa.BigInteger(), nullable=True),
        sa.Column("archived_category_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["installed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["track_id"], ["tournament_tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("guild_id"),
        sa.UniqueConstraint("track_id"),
    )
    op.create_index(
        op.f("ix_discord_guild_links_tournament_id"),
        "discord_guild_links",
        ["tournament_id"],
        unique=False,
    )
    op.create_table(
        "discord_managed_channels",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("link_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("discord_channel_id", sa.BigInteger(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["link_id"], ["discord_guild_links.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_discord_managed_channel_live_key",
        "discord_managed_channels",
        ["link_id", "key"],
        unique=True,
        postgresql_where=sa.text("NOT archived"),
    )
    op.create_table(
        "discord_managed_roles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("link_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("nexus_id", sa.Integer(), nullable=False),
        sa.Column("discord_role_id", sa.BigInteger(), nullable=False),
        sa.Column("tier", sa.String(length=8), nullable=True),
        sa.ForeignKeyConstraint(["link_id"], ["discord_guild_links.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("link_id", "kind", "nexus_id", name="uq_discord_managed_role"),
    )
    op.create_table(
        "discord_sync_marks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("link_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("discord_user_id", sa.BigInteger(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["link_id"], ["discord_guild_links.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "link_id",
            "kind",
            "discord_user_id",
            name="uq_discord_sync_mark",
            postgresql_nulls_not_distinct=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("discord_sync_marks")
    op.drop_table("discord_managed_roles")
    op.drop_index(
        "uq_discord_managed_channel_live_key",
        table_name="discord_managed_channels",
        postgresql_where=sa.text("NOT archived"),
    )
    op.drop_table("discord_managed_channels")
    op.drop_index(op.f("ix_discord_guild_links_tournament_id"), table_name="discord_guild_links")
    op.drop_table("discord_guild_links")
