"""drop track self-service settings

Revision ID: c7a6ecd30321
Revises: 17852c91b77c
Create Date: 2026-10-19 20:49:10.075738

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7a6ecd30321"
down_revision: str | Sequence[str] | None = "17852c91b77c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("tournament_tracks", "allow_confirm")
    op.drop_column("tournament_tracks", "lock_responses")


# Re-adds both columns as false; the dropped settings aren't restored.
def downgrade() -> None:
    op.add_column(
        "tournament_tracks",
        sa.Column(
            "lock_responses",
            sa.BOOLEAN(),
            server_default=sa.text("false"),
            autoincrement=False,
            nullable=False,
        ),
    )
    op.add_column(
        "tournament_tracks",
        sa.Column(
            "allow_confirm",
            sa.BOOLEAN(),
            server_default=sa.text("false"),
            autoincrement=False,
            nullable=False,
        ),
    )
