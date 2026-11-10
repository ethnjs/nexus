"""merge email codes with field key settings

Revision ID: ee27edb01d17
Revises: 76e8d1ef7474, fc57ee38d581
Create Date: 2026-11-09 12:00:00.000000

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "ee27edb01d17"
down_revision: str | Sequence[str] | None = ("76e8d1ef7474", "fc57ee38d581")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# The two sides touch different tables, so their order doesn't matter.
def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
