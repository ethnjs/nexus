"""drop building_id from tournament_event_tracks; rooms name the building

Revision ID: 6beb17fe3470
Revises: 0b1ad7d66816
Create Date: 2026-11-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6beb17fe3470"
down_revision: str | None = "0b1ad7d66816"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("fk_event_track_building", "tournament_event_tracks", type_="foreignkey")
    op.drop_index(
        op.f("ix_tournament_event_tracks_building_id"), table_name="tournament_event_tracks"
    )
    op.drop_column("tournament_event_tracks", "building_id")


def downgrade() -> None:
    op.add_column(
        "tournament_event_tracks",
        sa.Column("building_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        op.f("ix_tournament_event_tracks_building_id"),
        "tournament_event_tracks",
        ["building_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_event_track_building",
        "tournament_event_tracks",
        "tournament_building_tracks",
        ["building_id", "track_id"],
        ["building_id", "track_id"],
        ondelete="RESTRICT",
    )
