"""merge event relationships with email codes

Revision ID: 9286c7cebb08
Revises: ee27edb01d17, c41e8b7d2a96
Create Date: 2026-11-09 12:30:00.000000

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "9286c7cebb08"
down_revision: str | Sequence[str] | None = ("ee27edb01d17", "c41e8b7d2a96")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# The two sides touch different tables, so their order doesn't matter.
def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
