"""add auth fields

Revision ID: f4e526de3a94
Revises: b079268fceb2
Create Date: 2026-03-08 16:00:47.402507

No-Op

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4e526de3a94'
down_revision: Union[str, None] = 'b079268fceb2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
