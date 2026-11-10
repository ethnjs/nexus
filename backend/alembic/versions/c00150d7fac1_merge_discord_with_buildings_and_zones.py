"""merge discord with buildings and zones

Revision ID: c00150d7fac1
Revises: ee23ab79b639, f44f9009af1f
Create Date: 2026-11-10 01:27:25.954071

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "c00150d7fac1"
down_revision: str | Sequence[str] | None = ("ee23ab79b639", "f44f9009af1f")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
