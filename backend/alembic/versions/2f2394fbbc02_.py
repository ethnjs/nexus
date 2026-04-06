"""add_eight_columns_to_memberships

Revision ID: 2f2394fbbc02
Revises: f6a7b8c9d0e1
Create Date: 2026-04-05 23:41:23.747905

Adds 8 columns to memberships table for volunteer personal information:
  - shirt_size
  - dietary_restriction
  - university
  - major
  - employer
  - student_status
  - competition_exp
  - volunteering_exp

NOTE: These are temporary columns per the model comment "remove when user account
self-management is implemented". They duplicate User fields but are kept on Membership
to support per-tournament overrides during the initial phases.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2f2394fbbc02'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('memberships', schema=None) as batch_op:
        batch_op.add_column(sa.Column('shirt_size', sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column('dietary_restriction', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('university', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('major', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('employer', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('student_status', sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column('competition_exp', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('volunteering_exp', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('memberships', schema=None) as batch_op:
        batch_op.drop_column('volunteering_exp')
        batch_op.drop_column('competition_exp')
        batch_op.drop_column('student_status')
        batch_op.drop_column('employer')
        batch_op.drop_column('major')
        batch_op.drop_column('university')
        batch_op.drop_column('dietary_restriction')
        batch_op.drop_column('shirt_size')