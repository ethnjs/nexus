"""merge lock_responses with event logistics

Revision ID: 5aac03cebf88
Revises: 9777a35487d8, 5b5c2f46ad06
Create Date: 2026-09-29 14:13:51.588542

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5aac03cebf88'
down_revision: Union[str, None] = ('9777a35487d8', '5b5c2f46ad06')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# A merge, not a re-parent: a database already at either head (prod at the
# lock column, a branch database at the logistics chain) upgrades from where
# it is. The two sides touch different tables, so their order doesn't matter.
def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
