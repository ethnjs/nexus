"""add output_type to tournament_export_presets

Revision ID: 8d1e3a6f2b47
Revises: 5cf4c815b3ed
Create Date: 2026-10-11

Where a saved export goes: copy, csv or txt. Existing presets become "copy",
the old per-viewer default.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8d1e3a6f2b47'
down_revision: Union[str, None] = '5cf4c815b3ed'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'tournament_export_presets',
        sa.Column('output_type', sa.String(length=8), nullable=False, server_default='copy'),
    )


def downgrade() -> None:
    op.drop_column('tournament_export_presets', 'output_type')
