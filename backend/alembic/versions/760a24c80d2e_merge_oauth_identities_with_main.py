"""merge oauth_identities with main

Revision ID: 760a24c80d2e
Revises: a4e8c1b90d27, 63863039d4f1
Create Date: 2026-10-16 00:51:23.490191

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "760a24c80d2e"
down_revision: str | Sequence[str] | None = ("a4e8c1b90d27", "63863039d4f1")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
