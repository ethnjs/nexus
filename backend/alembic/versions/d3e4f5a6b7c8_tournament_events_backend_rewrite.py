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

  - tournament_events: drop `blocks` and `category` columns (no migration
    path — old free-text categories don't reliably match canonical
    category names, and the old block-scheduling system is gone, not
    migrated to shifts)
  - tournament_events: `division` and `name` made nullable (`name` is now
    custom-event-only display text — catalog-linked events display the
    joined Event.name instead)
  - tournament_events: add `event_id` FK to events (SET NULL), nullable
  - tournament_events: add `start_time`/`end_time`, backfilled from the
    parent tournament's start_date/end_date (else now()) since existing
    rows have no equivalent data — flagged for TD review via a one-off
    `# TODO(temp)` data note printed during migration, not a new column
  - tournament_events: drop `uq_tournament_event_division`, add a partial
    unique index on (tournament_id, event_id, division) WHERE event_id IS
    NOT NULL — custom (event_id-less) events have no uniqueness constraint
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


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

    # ------------------------------------------------------------------
    # tournament_events — drop blocks/category, add event_id, add
    # start_time/end_time (backfilled), relax division, swap the unique
    # constraint for a partial unique index scoped to catalog-linked rows
    # ------------------------------------------------------------------
    op.drop_constraint("uq_tournament_event_division", "tournament_events", type_="unique")
    op.alter_column("tournament_events", "division", existing_type=sa.String(length=4), nullable=True)
    op.alter_column("tournament_events", "name", existing_type=sa.String(length=255), nullable=True)

    op.drop_column("tournament_events", "blocks")
    op.drop_column("tournament_events", "category")

    op.add_column(
        "tournament_events",
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("events.id", ondelete="SET NULL"), nullable=True),
    )

    # start_time/end_time: add nullable first so the backfill can run, then
    # tighten to NOT NULL once every row has a value.
    op.add_column("tournament_events", sa.Column("start_time", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tournament_events", sa.Column("end_time", sa.DateTime(timezone=True), nullable=True))

    conn = op.get_bind()
    # TODO(temp): backfilled from the parent tournament's date range since
    # old `blocks` was a scheduling mechanism, not a datetime range — TD
    # should review/adjust these once the events UI ships. Flag in PR.
    result = conn.execute(
        text(
            """
            UPDATE tournament_events te
            SET start_time = COALESCE(t.start_date::timestamptz, now()),
                end_time   = COALESCE(t.end_date::timestamptz, now())
            FROM tournaments t
            WHERE t.id = te.tournament_id
            """
        )
    )
    print(f"[d3e4f5a6b7c8] backfilled start_time/end_time on {result.rowcount} tournament_events row(s) "
          f"from parent tournament dates — needs TD review, see TODO(temp) in this migration")

    op.alter_column("tournament_events", "start_time", existing_type=sa.DateTime(timezone=True), nullable=False)
    op.alter_column("tournament_events", "end_time", existing_type=sa.DateTime(timezone=True), nullable=False)

    op.create_index(
        "uq_tournament_event_catalog_division",
        "tournament_events",
        ["tournament_id", "event_id", "division"],
        unique=True,
        postgresql_where=text("event_id IS NOT NULL"),
    )


def downgrade() -> None:
    # ------------------------------------------------------------------
    # tournament_events — restore blocks/category/old unique constraint,
    # drop event_id/start_time/end_time
    # NOTE: data will be lost on downgrade (event_id links, start/end times).
    # ------------------------------------------------------------------
    op.drop_index("uq_tournament_event_catalog_division", table_name="tournament_events")

    op.drop_column("tournament_events", "end_time")
    op.drop_column("tournament_events", "start_time")
    op.drop_column("tournament_events", "event_id")

    op.add_column("tournament_events", sa.Column("category", sa.String(length=255), nullable=True))
    op.add_column("tournament_events", sa.Column("blocks", sa.JSON(), nullable=False, server_default="[]"))
    op.alter_column("tournament_events", "blocks", server_default=None)

    op.alter_column("tournament_events", "division", existing_type=sa.String(length=4), nullable=False)
    op.alter_column("tournament_events", "name", existing_type=sa.String(length=255), nullable=False)
    op.create_unique_constraint(
        "uq_tournament_event_division", "tournament_events", ["tournament_id", "name", "division"]
    )

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
