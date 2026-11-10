"""make room names unique case-insensitively within a building

Revision ID: f44f9009af1f
Revises: 3a4276b40bfc
Create Date: 2026-11-10

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f44f9009af1f"
down_revision: str | Sequence[str] | None = "3a4276b40bfc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("uq_tournament_room_name", "tournament_rooms", type_="unique")
    op.create_index(
        "uq_tournament_room_name",
        "tournament_rooms",
        ["building_id", sa.text("lower(name)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_tournament_room_name", table_name="tournament_rooms")
    op.create_unique_constraint(
        "uq_tournament_room_name", "tournament_rooms", ["building_id", "name"]
    )
