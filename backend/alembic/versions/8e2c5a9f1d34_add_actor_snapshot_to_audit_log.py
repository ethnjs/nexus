"""add actor snapshot to audit log

Revision ID: 8e2c5a9f1d34
Revises: c7a6ecd30321
Create Date: 2026-11-07 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8e2c5a9f1d34"
down_revision: str | Sequence[str] | None = "c7a6ecd30321"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Entries whose actor was already deleted have no actor_id left to copy from,
# so they stay null.
def upgrade() -> None:
    op.add_column(
        "audit_log_entries", sa.Column("actor_name", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "audit_log_entries", sa.Column("actor_email", sa.String(length=255), nullable=True)
    )
    op.execute(
        """
        UPDATE audit_log_entries AS a
        SET actor_name = NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
            actor_email = u.email
        FROM users AS u
        WHERE a.actor_id = u.id
        """
    )


def downgrade() -> None:
    op.drop_column("audit_log_entries", "actor_email")
    op.drop_column("audit_log_entries", "actor_name")
