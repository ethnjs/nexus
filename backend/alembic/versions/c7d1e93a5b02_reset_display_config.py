"""reset display_config for the columns/sections rework

Revision ID: c7d1e93a5b02
Revises: a1c4f2b90d17
Create Date: 2026-09-02

The surface shape gained `columns` (members table) and `sections` (member
panel) and lost nothing, but the saved `hidden` lists were written against
a model where hiding was the only operation. Rather than guess how an old
hidden list should map onto the new section order, every tournament starts
from the defaults — everything visible, default order.

Data-only: the column itself is unchanged.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c7d1e93a5b02'
down_revision: Union[str, None] = 'a1c4f2b90d17'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE tournaments SET display_config = '{}'::json")


def downgrade() -> None:
    # The old contents are gone either way — this only restores the shape a
    # pre-rework reader expects to find.
    op.execute("UPDATE tournaments SET display_config = '{}'::json")
