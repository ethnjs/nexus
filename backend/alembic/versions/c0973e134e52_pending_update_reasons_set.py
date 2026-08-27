"""pending update reasons set

Phase 3 of the form edit lifecycle work (see backend/form-edit-lifecycle.md).

`reason` held one of two values and escalated one-way. Change classification
produces six, and several can apply to the same field in one save, so it
becomes a set that unions instead.

Revision ID: c0973e134e52
Revises: 30da722fb9b4
Create Date: 2026-08-27 00:12:44.882910

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c0973e134e52'
down_revision: Union[str, None] = '30da722fb9b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('form_response_pending_updates', sa.Column('reasons', sa.JSON(), nullable=True))

    # Map the old pair onto the new vocabulary. field_replaced only ever came
    # from a question_type change or a removal; removals no longer flag at
    # all, so every surviving row of that kind is a type change.
    op.execute("""
        UPDATE form_response_pending_updates
        SET reasons = CASE reason
            WHEN 'option_archived' THEN '["option_invalidated"]'::json
            ELSE '["question_type_changed"]'::json
        END
    """)

    op.alter_column('form_response_pending_updates', 'reasons', nullable=False)
    op.drop_column('form_response_pending_updates', 'reason')


def downgrade() -> None:
    op.add_column('form_response_pending_updates', sa.Column('reason', sa.String(length=32), nullable=True))
    # Collapse back to the single stronger value; the extra reasons the new
    # vocabulary carries have no pre-Phase-3 equivalent and are dropped.
    op.execute("""
        UPDATE form_response_pending_updates
        SET reason = CASE
            WHEN reasons::jsonb ? 'option_invalidated'
             AND jsonb_array_length(reasons::jsonb) = 1 THEN 'option_archived'
            ELSE 'field_replaced'
        END
    """)
    op.alter_column('form_response_pending_updates', 'reason', nullable=False)
    op.drop_column('form_response_pending_updates', 'reasons')
