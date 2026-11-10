"""merge discord with main again

Revision ID: ee23ab79b639
Revises: e7839a9d757b, 76e8d1ef7474
Create Date: 2026-11-09 20:46:44.508247

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "ee23ab79b639"
down_revision: str | Sequence[str] | None = ("e7839a9d757b", "76e8d1ef7474")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
