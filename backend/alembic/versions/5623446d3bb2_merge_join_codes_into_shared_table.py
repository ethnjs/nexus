"""merge join codes into shared table

Revision ID: 5623446d3bb2
Revises: 28eb6df629e1
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5623446d3bb2'
down_revision: Union[str, None] = '28eb6df629e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('join_codes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=True),
    sa.Column('chapter_id', sa.Integer(), nullable=True),
    sa.Column('created_by', sa.Integer(), nullable=False),
    sa.Column('code', sa.String(length=8), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('use_count', sa.Integer(), nullable=False, server_default='0'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['chapter_id'], ['alumni_chapters.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code'),
    sa.CheckConstraint(
        '(tournament_id IS NOT NULL) != (chapter_id IS NOT NULL)',
        name='ck_join_code_one_target',
    ),
    )

    op.execute("""
        INSERT INTO join_codes
            (tournament_id, chapter_id, created_by, code, label, expires_at, is_active, created_at, use_count)
        SELECT tournament_id, NULL, created_by, code, label, expires_at, is_active, created_at, use_count
        FROM tournament_join_codes
    """)
    op.execute("""
        INSERT INTO join_codes
            (tournament_id, chapter_id, created_by, code, label, expires_at, is_active, created_at, use_count)
        SELECT NULL, chapter_id, created_by, code, label, expires_at, is_active, created_at, use_count
        FROM chapter_join_codes
    """)

    op.drop_table('tournament_join_codes')
    op.drop_table('chapter_join_codes')


def downgrade() -> None:
    op.create_table('tournament_join_codes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=False),
    sa.Column('code', sa.String(length=8), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('use_count', sa.Integer(), nullable=False, server_default='0'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code'),
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
    sa.UniqueConstraint('code'),
    )

    op.execute("""
        INSERT INTO tournament_join_codes
            (tournament_id, created_by, code, label, expires_at, is_active, created_at, use_count)
        SELECT tournament_id, created_by, code, label, expires_at, is_active, created_at, use_count
        FROM join_codes WHERE tournament_id IS NOT NULL
    """)
    op.execute("""
        INSERT INTO chapter_join_codes
            (chapter_id, created_by, code, label, expires_at, is_active, created_at, use_count)
        SELECT chapter_id, created_by, code, label, expires_at, is_active, created_at, use_count
        FROM join_codes WHERE chapter_id IS NOT NULL
    """)

    op.drop_table('join_codes')
