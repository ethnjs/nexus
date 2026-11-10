"""add tournament_rooms and link event placements to them

Revision ID: 0b1ad7d66816
Revises: c41e8b7d2a96
Create Date: 2026-11-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0b1ad7d66816"
down_revision: str | None = "c41e8b7d2a96"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tournament_rooms",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("building_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("floor", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["building_id"], ["tournament_buildings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("building_id", "name", name="uq_tournament_room_name"),
    )
    op.create_index(op.f("ix_tournament_rooms_id"), "tournament_rooms", ["id"], unique=False)
    op.create_index(
        op.f("ix_tournament_rooms_building_id"), "tournament_rooms", ["building_id"], unique=False
    )
    op.create_table(
        "tournament_event_track_rooms",
        sa.Column("tournament_event_id", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("room_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["tournament_event_id", "track_id"],
            ["tournament_event_tracks.tournament_event_id", "tournament_event_tracks.track_id"],
            name="fk_event_track_room_link",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["room_id"], ["tournament_rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tournament_event_id", "track_id", "room_id"),
    )
    op.create_index(
        op.f("ix_tournament_event_track_rooms_room_id"),
        "tournament_event_track_rooms",
        ["room_id"],
        unique=False,
    )
    # No production data uses free-text rooms yet, so they are dropped rather
    # than copied into tournament_rooms.
    op.drop_column("tournament_event_tracks", "rooms")


def downgrade() -> None:
    op.add_column(
        "tournament_event_tracks",
        sa.Column("rooms", sa.JSON(), nullable=True),
    )
    op.drop_index(
        op.f("ix_tournament_event_track_rooms_room_id"), table_name="tournament_event_track_rooms"
    )
    op.drop_table("tournament_event_track_rooms")
    op.drop_index(op.f("ix_tournament_rooms_building_id"), table_name="tournament_rooms")
    op.drop_index(op.f("ix_tournament_rooms_id"), table_name="tournament_rooms")
    op.drop_table("tournament_rooms")
