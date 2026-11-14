"""add 18+ and 21+ staffing counts to event tracks

Revision ID: c4a9e7d2b815
Revises: b8e2d4f61a37
Create Date: 2026-11-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4a9e7d2b815"
down_revision: str | Sequence[str] | None = "b8e2d4f61a37"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tournament_event_tracks", sa.Column("over_18_needed", sa.Integer()))
    op.add_column("tournament_event_tracks", sa.Column("over_21_needed", sa.Integer()))
    op.create_check_constraint(
        "ck_event_track_over_18_positive",
        "tournament_event_tracks",
        "over_18_needed IS NULL OR over_18_needed >= 1",
    )
    op.create_check_constraint(
        "ck_event_track_over_21_positive",
        "tournament_event_tracks",
        "over_21_needed IS NULL OR over_21_needed >= 1",
    )


def downgrade() -> None:
    op.drop_constraint("ck_event_track_over_21_positive", "tournament_event_tracks", type_="check")
    op.drop_constraint("ck_event_track_over_18_positive", "tournament_event_tracks", type_="check")
    op.drop_column("tournament_event_tracks", "over_21_needed")
    op.drop_column("tournament_event_tracks", "over_18_needed")
