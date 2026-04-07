"""consolidate sheet_type interest/confirmation to volunteers

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-27 00:00:00.000000

Changes:
  - sheet_configs: migrate sheet_type values
      "interest"     → "volunteers"
      "confirmation" → "volunteers"
  - sheet_configs: drop UNIQUE constraint on (tournament_id, sheet_type)
      The old constraint enforced one config per type per tournament.
      Now that "interest" and "confirmation" both collapse to "volunteers",
      the constraint would fire on tournaments that had both. Removed
      entirely — duplicate sheet types are already guarded at the UX level.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # sheet_configs — drop the unique constraint first so the type update
    # can't trigger a violation mid-migration on tournaments that had both
    # "interest" and "confirmation" configs.
    # ------------------------------------------------------------------
    with op.batch_alter_table("sheet_configs") as batch_op:
        batch_op.drop_constraint("uq_tournament_sheet_type", type_="unique")

    # ------------------------------------------------------------------
    # Migrate legacy sheet_type values → current equivalents
    # ------------------------------------------------------------------
    conn = op.get_bind()
    conn.execute(
        text(
            "UPDATE sheet_configs SET sheet_type = 'volunteers' "
            "WHERE sheet_type IN ('interest', 'confirmation')"
        )
    )


def downgrade() -> None:
    # ------------------------------------------------------------------
    # Restore the unique constraint.
    # NOTE: data cannot be un-collapsed — "volunteers" rows that originated
    # as "interest" or "confirmation" are indistinguishable after upgrade.
    # Downgrade only restores the constraint shape, not the original values.
    # ------------------------------------------------------------------
    with op.batch_alter_table("sheet_configs") as batch_op:
        batch_op.create_unique_constraint(
            "uq_tournament_sheet_type",
            ["tournament_id", "sheet_type"],
        )