"""Alumni Chapters

- Add canonical University table
- Add Alumni Chapters and Alumni Memberships table
- Add alumni chapter Join Code table
- Add Tournament--Alumni Chapter relationship table

Revision ID: 2cc03b477680
Revises: 3cb43e5b0a3f
Create Date: 2026-07-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2cc03b477680'
down_revision: Union[str, None] = '3cb43e5b0a3f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('universities',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('abbreviation', sa.String(length=32), nullable=True),
        sa.Column('location', sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
    )
    op.add_column('tournaments', sa.Column('university_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'tournaments', 'universities', ['university_id'], ['id'])
    op.add_column('users', sa.Column('university_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'users', 'universities', ['university_id'], ['id'])
    op.drop_column('users', 'university')

    op.create_table('alumni_chapters',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('university_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['university_id'], ['universities.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('university_id')
    )

    op.create_table('chapter_memberships',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('chapter_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=32), nullable=False),
        sa.Column('joined_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['chapter_id'], ['alumni_chapters.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id')
    )

    op.create_table('chapter_join_codes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('chapter_id', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(length=8), nullable=False),
        sa.Column('label', sa.String(length=255), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('use_count', sa.Integer(), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['chapter_id'], ['alumni_chapters.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code')
    )

    op.create_table('tournament_chapters',
        sa.Column('tournament_id', sa.Integer(), nullable=False),
        sa.Column('chapter_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['chapter_id'], ['alumni_chapters.id'], ),
        sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ),
        sa.PrimaryKeyConstraint('tournament_id', 'chapter_id')
    )


def downgrade() -> None:
    op.drop_table('tournament_chapters')
    op.drop_table('chapter_join_codes')
    op.drop_table('chapter_memberships')
    op.drop_table('alumni_chapters')

    op.add_column('users', sa.Column('university', sa.VARCHAR(length=255), autoincrement=False, nullable=True))
    op.drop_constraint('users_university_id_fkey', 'users', type_='foreignkey')
    op.drop_column('users', 'university_id')
    op.drop_constraint('tournaments_university_id_fkey', 'tournaments', type_='foreignkey')
    op.drop_column('tournaments', 'university_id')
    op.drop_table('universities')
