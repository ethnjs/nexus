"""merge zone room rules with email codes

Revision ID: 3a4276b40bfc
Revises: 9286c7cebb08, b7e2d4a91c3f
Create Date: 2026-11-09 13:00:00.000000

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "3a4276b40bfc"
down_revision: str | Sequence[str] | None = ("9286c7cebb08", "b7e2d4a91c3f")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# The two sides touch different tables, so their order doesn't matter.
def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
