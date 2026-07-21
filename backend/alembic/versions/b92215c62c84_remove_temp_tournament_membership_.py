"""remove_temp_tournament_membership_profile_fields

Revision ID: b92215c62c84
Revises: a429a58260de
Create Date: 2026-07-20 23:00:25.425825

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b92215c62c84'
down_revision: Union[str, None] = 'a429a58260de'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('tournament_memberships', 'major')
    op.drop_column('tournament_memberships', 'volunteering_exp')
    op.drop_column('tournament_memberships', 'dietary_restriction')
    op.drop_column('tournament_memberships', 'shirt_size')
    op.drop_column('tournament_memberships', 'university')
    op.drop_column('tournament_memberships', 'competition_exp')
    op.drop_column('tournament_memberships', 'employer')
    op.drop_column('tournament_memberships', 'student_status')


def downgrade() -> None:
    op.add_column('tournament_memberships', sa.Column('student_status', sa.VARCHAR(length=100), autoincrement=False, nullable=True))
    op.add_column('tournament_memberships', sa.Column('employer', sa.VARCHAR(length=255), autoincrement=False, nullable=True))
    op.add_column('tournament_memberships', sa.Column('competition_exp', sa.TEXT(), autoincrement=False, nullable=True))
    op.add_column('tournament_memberships', sa.Column('university', sa.VARCHAR(length=255), autoincrement=False, nullable=True))
    op.add_column('tournament_memberships', sa.Column('shirt_size', sa.VARCHAR(length=16), autoincrement=False, nullable=True))
    op.add_column('tournament_memberships', sa.Column('dietary_restriction', sa.VARCHAR(length=255), autoincrement=False, nullable=True))
    op.add_column('tournament_memberships', sa.Column('volunteering_exp', sa.TEXT(), autoincrement=False, nullable=True))
    op.add_column('tournament_memberships', sa.Column('major', sa.VARCHAR(length=255), autoincrement=False, nullable=True))
