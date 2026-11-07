"""merge terms acceptance with main

Revision ID: edf3b25e2e7b
Revises: 3f9b2d7e41a6, c4a9e7d2b815
Create Date: 2026-11-21 03:11:59.430288

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "edf3b25e2e7b"
down_revision: str | Sequence[str] | None = ("3f9b2d7e41a6", "c4a9e7d2b815")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
