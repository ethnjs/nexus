"""add allow_confirm to tournament_tracks

Revision ID: e5c2b7a91f38
Revises: d3f8a1c74b26
Create Date: 2026-09-03

Gates whether a member can confirm themselves on a track from their own
member page. False everywhere to begin with: on most tracks `confirmed`
means the TD staffed them, so turning it on has to be a deliberate act.
Declining never consults this flag.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e5c2b7a91f38'
down_revision: Union[str, None] = 'd3f8a1c74b26'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tournament_tracks",
        sa.Column("allow_confirm", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("tournament_tracks", "allow_confirm")
