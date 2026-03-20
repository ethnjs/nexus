"""membership positions schedule, drop roles and general_volunteer_interest, user role simplification

Revision ID: a1b2c3d4e5f6
Revises: f4e526de3a94
Create Date: 2026-03-17 00:00:00.000000

Changes:
  - memberships: drop `roles` column
  - memberships: drop `general_volunteer_interest` column (now lives in extra_data)
  - memberships: add `positions` JSON column (list of position keys)
  - memberships: add `schedule` JSON column (list of {block, duty} dicts)
  - users: migrate role values
      "td"        → "user"
      "volunteer" → "user"
      "admin"     → "admin"  (unchanged)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f4e526de3a94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # memberships — drop roles + general_volunteer_interest,
    #               add positions + schedule
    # ------------------------------------------------------------------
    op.drop_column("memberships", "roles")
    op.drop_column("memberships", "general_volunteer_interest")

    op.add_column(
        "memberships",
        sa.Column("positions", sa.JSON(), nullable=True),
    )
    op.add_column(
        "memberships",
        sa.Column("schedule", sa.JSON(), nullable=True),
    )

    # ------------------------------------------------------------------
    # users — collapse "td" and "volunteer" → "user"
    # ------------------------------------------------------------------
    conn = op.get_bind()
    conn.execute(
        text("UPDATE users SET role = 'user' WHERE role IN ('td', 'volunteer')")
    )


def downgrade() -> None:
    # ------------------------------------------------------------------
    # memberships — restore dropped columns, remove new ones
    # NOTE: data will be lost on downgrade.
    # ------------------------------------------------------------------
    op.drop_column("memberships", "schedule")
    op.drop_column("memberships", "positions")

    op.add_column(
        "memberships",
        sa.Column("roles", sa.JSON(), nullable=True),
    )
    op.add_column(
        "memberships",
        sa.Column("general_volunteer_interest", sa.JSON(), nullable=True),
    )

    # ------------------------------------------------------------------
    # users — cannot recover original roles, fall back to "volunteer"
    # ------------------------------------------------------------------
    conn = op.get_bind()
    conn.execute(
        text("UPDATE users SET role = 'volunteer' WHERE role = 'user'")
    )