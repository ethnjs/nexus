"""user profile and exp

Revision ID: a429a58260de
Revises: f250cb93a643
Create Date: 2026-07-03 13:29:34.804962

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a429a58260de'
down_revision: Union[str, None] = 'f250cb93a643'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('date_of_birth', sa.Date(), nullable=True))
    op.add_column('users', sa.Column('pronouns', sa.String(length=100), nullable=True))
    op.add_column('users', sa.Column('has_competition_experience', sa.Boolean(), nullable=True))
    op.add_column('users', sa.Column('has_volunteer_experience', sa.Boolean(), nullable=True))
    op.drop_column('users', 'competition_exp')
    op.drop_column('users', 'volunteering_exp')


def downgrade() -> None:
    op.add_column('users', sa.Column('volunteering_exp', sa.TEXT(), autoincrement=False, nullable=True))
    op.add_column('users', sa.Column('competition_exp', sa.TEXT(), autoincrement=False, nullable=True))
    op.drop_column('users', 'has_volunteer_experience')
    op.drop_column('users', 'has_competition_experience')
    op.drop_column('users', 'pronouns')
    op.drop_column('users', 'date_of_birth')
