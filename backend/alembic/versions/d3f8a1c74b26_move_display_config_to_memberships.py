"""move display_config from tournaments to tournament_memberships

Revision ID: d3f8a1c74b26
Revises: c7d1e93a5b02
Create Date: 2026-09-02

The config stops being one tournament-wide setting and becomes each viewer's
own: two coordinators reading the same roster keep their own columns, filters
and sort instead of overwriting each other's.

Saved configs are dropped rather than fanned out onto every membership —
same call c7d1e93a5b02 made for its own reshape. Everyone starts from the
defaults (all columns default, nothing hidden, no filters, default sort).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd3f8a1c74b26'
down_revision: Union[str, None] = 'c7d1e93a5b02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default so the NOT NULL holds for rows that already exist; the
    # model's own default=dict covers every row written from here on.
    op.add_column(
        "tournament_memberships",
        sa.Column("display_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )
    op.drop_column("tournaments", "display_config")


def downgrade() -> None:
    op.add_column(
        "tournaments",
        sa.Column("display_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )
    op.drop_column("tournament_memberships", "display_config")
