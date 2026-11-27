"""merge discord with user display config

Revision ID: 817e8c14e031
Revises: c00150d7fac1, d3f8a1c6e204
Create Date: 2026-11-24 23:46:54.891745

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "817e8c14e031"
down_revision: str | Sequence[str] | None = ("c00150d7fac1", "d3f8a1c6e204")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
