"""add tournament form prerequisites

Revision ID: 9f2e4a7b1c3d
Revises: 8d55ec2b6640
Create Date: 2026-08-25 00:00:00.000000

Standard tournament forms can optionally require completed onboarding, one or
more roles, and/or availability for selected shifts before a member can see
or answer them.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9f2e4a7b1c3d"
down_revision: Union[str, None] = "8d55ec2b6640"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tournament_forms",
        sa.Column("prerequisites", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    op.alter_column("tournament_forms", "prerequisites", server_default=None)


def downgrade() -> None:
    op.drop_column("tournament_forms", "prerequisites")
