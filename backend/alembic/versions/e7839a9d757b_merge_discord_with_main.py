"""merge discord with main

Revision ID: e7839a9d757b
Revises: b3d5f7a9c1e2, c7a6ecd30321
Create Date: 2026-10-20 15:34:26.138741

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "e7839a9d757b"
down_revision: str | Sequence[str] | None = ("b3d5f7a9c1e2", "c7a6ecd30321")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
