"""zone room rules and track zone role

Revision ID: b7e2d4a91c3f
Revises: a3c51e7d2b90
Create Date: 2026-11-09

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7e2d4a91c3f"
down_revision: str | None = "a3c51e7d2b90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SHAPE_WITH_ROOM = (
    "(kind = 'building' AND building_id IS NOT NULL AND floor IS NULL "
    "  AND room_id IS NULL AND tournament_event_id IS NULL) OR "
    "(kind = 'floor' AND building_id IS NOT NULL AND floor IS NOT NULL "
    "  AND room_id IS NULL AND tournament_event_id IS NULL) OR "
    "(kind = 'room' AND building_id IS NOT NULL AND room_id IS NOT NULL "
    "  AND floor IS NULL AND tournament_event_id IS NULL) OR "
    "(kind = 'event' AND tournament_event_id IS NOT NULL AND building_id IS NULL "
    "  AND floor IS NULL AND room_id IS NULL)"
)

SHAPE_WITHOUT_ROOM = (
    "(kind = 'building' AND building_id IS NOT NULL AND floor IS NULL "
    "  AND tournament_event_id IS NULL) OR "
    "(kind = 'floor' AND building_id IS NOT NULL AND floor IS NOT NULL "
    "  AND tournament_event_id IS NULL) OR "
    "(kind = 'event' AND tournament_event_id IS NOT NULL AND building_id IS NULL "
    "  AND floor IS NULL)"
)


def upgrade() -> None:
    op.add_column(
        "tournament_tracks", sa.Column("zone_default_role_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        "fk_tournament_tracks_zone_default_role_id",
        "tournament_tracks",
        "tournament_roles",
        ["zone_default_role_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_column("tournament_zones", "default_role_id")

    op.add_column("tournament_zone_members", sa.Column("room_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "tournament_zone_members_room_id_fkey",
        "tournament_zone_members",
        "tournament_rooms",
        ["room_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        op.f("ix_tournament_zone_members_room_id"),
        "tournament_zone_members",
        ["room_id"],
        unique=False,
    )
    op.create_index(
        "uq_zone_member_room",
        "tournament_zone_members",
        ["track_id", "room_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'room'"),
    )
    op.drop_constraint("ck_zone_member_shape", "tournament_zone_members", type_="check")
    op.create_check_constraint("ck_zone_member_shape", "tournament_zone_members", SHAPE_WITH_ROOM)


def downgrade() -> None:
    op.execute("DELETE FROM tournament_zone_members WHERE kind = 'room'")
    op.drop_constraint("ck_zone_member_shape", "tournament_zone_members", type_="check")
    op.create_check_constraint(
        "ck_zone_member_shape", "tournament_zone_members", SHAPE_WITHOUT_ROOM
    )
    op.drop_index(
        "uq_zone_member_room",
        table_name="tournament_zone_members",
        postgresql_where=sa.text("kind = 'room'"),
    )
    op.drop_index(op.f("ix_tournament_zone_members_room_id"), table_name="tournament_zone_members")
    op.drop_constraint(
        "tournament_zone_members_room_id_fkey", "tournament_zone_members", type_="foreignkey"
    )
    op.drop_column("tournament_zone_members", "room_id")

    op.add_column("tournament_zones", sa.Column("default_role_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "tournament_zones_default_role_id_fkey",
        "tournament_zones",
        "tournament_roles",
        ["default_role_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint(
        "fk_tournament_tracks_zone_default_role_id", "tournament_tracks", type_="foreignkey"
    )
    op.drop_column("tournament_tracks", "zone_default_role_id")
