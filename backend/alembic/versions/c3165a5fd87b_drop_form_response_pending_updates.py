"""drop form response pending updates

Revision ID: c3165a5fd87b
Revises: dcd0a5f34632
Create Date: 2026-10-19 18:40:44.969963

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c3165a5fd87b"
down_revision: str | Sequence[str] | None = "dcd0a5f34632"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index(
        op.f("ix_form_response_pending_updates_id"), table_name="form_response_pending_updates"
    )
    op.drop_table("form_response_pending_updates")


# Recreates the table empty; the dropped flags aren't restored.
def downgrade() -> None:
    op.create_table(
        "form_response_pending_updates",
        sa.Column("id", sa.INTEGER(), autoincrement=True, nullable=False),
        sa.Column("response_id", sa.VARCHAR(length=12), autoincrement=False, nullable=False),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False
        ),
        sa.Column("field_id", sa.VARCHAR(length=12), autoincrement=False, nullable=False),
        sa.Column(
            "reasons", postgresql.JSON(astext_type=sa.Text()), autoincrement=False, nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["field_id"],
            ["form_fields.id"],
            name=op.f("fk_pending_update_field_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["response_id"],
            ["form_responses.id"],
            name=op.f("form_response_pending_updates_response_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("form_response_pending_updates_pkey")),
        sa.UniqueConstraint(
            "response_id",
            "field_id",
            name=op.f("uq_pending_update_per_response_field"),
        ),
    )
    op.create_index(
        op.f("ix_form_response_pending_updates_id"),
        "form_response_pending_updates",
        ["id"],
        unique=False,
    )
