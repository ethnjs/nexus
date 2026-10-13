"""add auth fields

Revision ID: f4e526de3a94
Revises: b079268fceb2
Create Date: 2026-03-08 16:00:47.402507

No-Op

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "f4e526de3a94"
down_revision: str | None = "b079268fceb2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
