"""merge event logistics with allow_response_edits

Revision ID: 90c29492df5b
Revises: 5aac03cebf88, c5f1a9e3d2b7
Create Date: 2026-10-04 21:44:33.074526

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '90c29492df5b'
down_revision: Union[str, None] = ('5aac03cebf88', 'c5f1a9e3d2b7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Same reasoning as 5aac03cebf88: 5aac is already applied on preview databases,
# so it is merged forward rather than rewritten out of the history.
def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
