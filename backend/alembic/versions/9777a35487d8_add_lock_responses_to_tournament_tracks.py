"""add lock_responses to tournament_tracks

Revision ID: 9777a35487d8
Revises: d3b71a4c9e02
Create Date: 2026-09-29 00:39:52.285741

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9777a35487d8'
down_revision: Union[str, None] = 'd3b71a4c9e02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default so the NOT NULL holds against the rows already there;
    # every existing track starts unlocked. Same shape as allow_confirm
    # (e5c2b7a91f38), which this sits beside on the table.
    op.add_column(
        "tournament_tracks",
        sa.Column("lock_responses", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("tournament_tracks", "lock_responses")
