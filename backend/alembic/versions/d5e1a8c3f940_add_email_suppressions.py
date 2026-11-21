"""add email_suppressions

Revision ID: d5e1a8c3f940
Revises: d3f8a1c6e204
Create Date: 2026-11-21

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5e1a8c3f940"
down_revision: str | Sequence[str] | None = "d3f8a1c6e204"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_suppressions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("reason", sa.String(length=16), nullable=False),
        sa.Column("detail", sa.String(length=64), nullable=True),
        sa.Column("ses_message_id", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_email_suppressions_email"), "email_suppressions", ["email"], unique=True
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_email_suppressions_email"), table_name="email_suppressions")
    op.drop_table("email_suppressions")
