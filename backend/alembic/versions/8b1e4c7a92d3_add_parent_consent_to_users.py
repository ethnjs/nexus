"""add parent consent and age lock to users

Revision ID: 8b1e4c7a92d3
Revises: edf3b25e2e7b
Create Date: 2026-11-21 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8b1e4c7a92d3"
down_revision: str | Sequence[str] | None = "edf3b25e2e7b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("parent_consent_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("users", sa.Column("age_locked_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "age_locked_at")
    op.drop_column("users", "parent_consent_at")
