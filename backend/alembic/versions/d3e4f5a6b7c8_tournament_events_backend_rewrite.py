"""tournament events backend rewrite

Revision ID: d3e4f5a6b7c8
Revises: c7b3f4a9d2e1
Create Date: 2026-08-13 00:00:00.000000

Single migration for the tournament-events backend rewrite, built up
incrementally as the rewrite progresses:

  - tournament_memberships: drop `assigned_event_id` column (and its FK to
    tournament_events)
  - tournament_memberships: drop `schedule` column
  No backfill — this data is not being preserved or migrated anywhere.

  - tournament_shifts: new table — tournament-scoped time windows
  - tournament_event_shifts: new bridge table — TournamentEvent <-> TournamentShift
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, None] = "c7b3f4a9d2e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # tournament_memberships — drop assigned_event_id + schedule
    # ------------------------------------------------------------------
    op.drop_constraint(
        "memberships_assigned_event_id_fkey",
        "tournament_memberships",
        type_="foreignkey",
    )
    op.drop_column("tournament_memberships", "assigned_event_id")
    op.drop_column("tournament_memberships", "schedule")

    # ------------------------------------------------------------------
    # tournament_shifts + tournament_event_shifts — new tables
    # ------------------------------------------------------------------
    op.create_table(
        "tournament_shifts",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("tournament_id", sa.Integer(), sa.ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "tournament_event_shifts",
        sa.Column("tournament_event_id", sa.Integer(), sa.ForeignKey("tournament_events.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tournament_shift_id", sa.Integer(), sa.ForeignKey("tournament_shifts.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade() -> None:
    # ------------------------------------------------------------------
    # tournament_shifts + tournament_event_shifts — drop new tables
    # ------------------------------------------------------------------
    op.drop_table("tournament_event_shifts")
    op.drop_table("tournament_shifts")

    # ------------------------------------------------------------------
    # tournament_memberships — restore assigned_event_id + schedule
    # NOTE: data will be lost on downgrade.
    # ------------------------------------------------------------------
    op.add_column(
        "tournament_memberships",
        sa.Column("schedule", sa.JSON(), nullable=True),
    )
    op.add_column(
        "tournament_memberships",
        sa.Column("assigned_event_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "memberships_assigned_event_id_fkey",
        "tournament_memberships",
        "tournament_events",
        ["assigned_event_id"],
        ["id"],
        ondelete="SET NULL",
    )
