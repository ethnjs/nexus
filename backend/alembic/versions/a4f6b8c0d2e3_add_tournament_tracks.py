"""add tournament tracks

Revision ID: a4f6b8c0d2e3
Revises: 8d55ec2b6640
Create Date: 2026-08-26 00:00:00.000000

Tracks are tournament-managed catalog entries used by later reserved track
fields and membership-track statuses. They archive rather than delete so the
catalog can retire a track while preserving historical references.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a4f6b8c0d2e3"
down_revision: Union[str, None] = "8d55ec2b6640"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tournament_tracks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tournament_id", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_archived", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", "slug", name="uq_tournament_track_slug"),
    )
    op.create_index(op.f("ix_tournament_tracks_id"), "tournament_tracks", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_tournament_tracks_id"), table_name="tournament_tracks")
    op.drop_table("tournament_tracks")
