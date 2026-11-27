"""merge discord with saved filters

Revision ID: da6a26648911
Revises: 817e8c14e031, f7a3d8e2c614
Create Date: 2026-11-27 01:38:44.417179

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "da6a26648911"
down_revision: str | Sequence[str] | None = ("817e8c14e031", "f7a3d8e2c614")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
