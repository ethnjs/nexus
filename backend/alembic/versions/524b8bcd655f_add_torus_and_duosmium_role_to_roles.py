"""add torus_role and duosmium_role to tournament_roles

Revision ID: 524b8bcd655f
Revises: 8a438a1a14a3
Create Date: 2026-10-09

What each role maps to in TORUS and Duosmium, for the exports (#108).
Nullable with no default, so every existing role starts unmapped.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '524b8bcd655f'
down_revision: Union[str, None] = '8a438a1a14a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tournament_roles', sa.Column('torus_role', sa.String(length=32), nullable=True))
    op.add_column('tournament_roles', sa.Column('duosmium_role', sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column('tournament_roles', 'duosmium_role')
    op.drop_column('tournament_roles', 'torus_role')
