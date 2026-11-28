"""link discord accounts

Revision ID: 61957c8fe811
Revises: 760a24c80d2e
Create Date: 2026-10-16 01:06:07.102783

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "61957c8fe811"
down_revision: str | Sequence[str] | None = "760a24c80d2e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Postgres can't use a new enum value inside the transaction that added it.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE oauth_provider ADD VALUE IF NOT EXISTS 'discord'")
    op.add_column(
        "oauth_identities", sa.Column("username_at_provider", sa.String(length=255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("oauth_identities", "username_at_provider")
    # Postgres can't drop an enum value, so 'discord' stays on the type.
    op.execute("DELETE FROM oauth_identities WHERE provider = 'discord'")
