"""add source and join_code_id to tournament_memberships

Revision ID: faa21d1f5a4a
Revises: 5623446d3bb2
Create Date: 2026-08-04 19:13:55.032177

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'faa21d1f5a4a'
down_revision: Union[str, None] = '5623446d3bb2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing rows predate this column — backfill as "manual" before
    # tightening to NOT NULL, since none of them came from a join code.
    op.add_column('tournament_memberships', sa.Column('source', sa.String(length=32), nullable=True))
    op.execute("UPDATE tournament_memberships SET source = 'manual' WHERE source IS NULL")
    op.alter_column('tournament_memberships', 'source', nullable=False)

    op.add_column('tournament_memberships', sa.Column('join_code_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_tournament_memberships_join_code_id', 'tournament_memberships', 'join_codes',
        ['join_code_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_tournament_memberships_join_code_id', 'tournament_memberships', type_='foreignkey')
    op.drop_column('tournament_memberships', 'join_code_id')
    op.drop_column('tournament_memberships', 'source')
