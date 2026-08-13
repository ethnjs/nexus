"""tournament roles, permissions, join codes, and settings rebuild

Combines what were 8 separate revisions on this branch into one, since
none of them ever shipped to main and squashing avoids an 8-step
upgrade/downgrade chain for a single feature.

Revision ID: c7b3f4a9d2e1
Revises: 2cc03b477680
Create Date: 2026-08-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c7b3f4a9d2e1'
down_revision: Union[str, None] = '2cc03b477680'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- relational roles/permissions, replacing the old JSON blob columns ---
    op.create_table('tournament_roles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=False),
    sa.Column('permissions', sa.JSON(), nullable=False),
    sa.Column('rank', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tournament_id', 'label', name='uq_tournament_role_label')
    )
    op.create_index(op.f('ix_tournament_roles_id'), 'tournament_roles', ['id'], unique=False)

    op.create_table('tournament_membership_roles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('membership_id', sa.Integer(), nullable=False),
    sa.Column('role_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['membership_id'], ['tournament_memberships.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['role_id'], ['tournament_roles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('membership_id', 'role_id', name='uq_membership_role')
    )
    op.create_index(op.f('ix_tournament_membership_roles_id'), 'tournament_membership_roles', ['id'], unique=False)

    op.create_table('audit_log_entries',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=False),
    sa.Column('actor_id', sa.Integer(), nullable=False),
    sa.Column('action', sa.String(length=64), nullable=False),
    sa.Column('target_type', sa.String(length=64), nullable=True),
    sa.Column('target_id', sa.Integer(), nullable=True),
    sa.Column('extra_data', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )

    op.drop_column('tournament_memberships', 'positions')
    op.drop_column('tournaments', 'volunteer_schema')
    op.drop_column('tournaments', 'blocks')

    # --- join codes: shared table for both tournaments and chapters ---
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
        SELECT NULL, chapter_id, created_by, code, label, expires_at, is_active, created_at, use_count
        FROM chapter_join_codes
    """)
    op.drop_table('chapter_join_codes')

    # --- membership source tracking + link back to the join code used ---
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

    # --- tournament visibility/discovery flags ---
    op.add_column('tournaments', sa.Column('is_public', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('tournaments', sa.Column('is_verified', sa.Boolean(), nullable=False, server_default=sa.text('false')))

    # --- tournament identity fields: short_name, state, level, division; require dates ---
    op.add_column('tournaments', sa.Column('short_name', sa.String(length=64), nullable=True))
    op.add_column('tournaments', sa.Column('state', sa.String(length=32), nullable=False, server_default=''))
    op.add_column('tournaments', sa.Column('level', sa.String(length=32), nullable=False, server_default=''))
    op.add_column('tournaments', sa.Column('division', sa.JSON(), nullable=False, server_default='[]'))
    op.alter_column('tournaments', 'state', server_default=None)
    op.alter_column('tournaments', 'level', server_default=None)
    op.alter_column('tournaments', 'division', server_default=None)
    op.alter_column('tournaments', 'start_date',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               nullable=False)
    op.alter_column('tournaments', 'end_date',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               nullable=False)

    # --- start_date/end_date: timestamp -> date-only, display is date-only anyway ---
    op.alter_column('tournaments', 'start_date',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               type_=sa.Date(),
               existing_nullable=False,
               postgresql_using='start_date::date')
    op.alter_column('tournaments', 'end_date',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               type_=sa.Date(),
               existing_nullable=False,
               postgresql_using='end_date::date')

    # --- archive lifecycle: auto-archive flag + manual override timestamp ---
    op.add_column('tournaments', sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column('tournaments', 'is_archived', server_default=None)
    op.add_column('tournaments', sa.Column('archive_override_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('tournaments', 'archive_override_at')
    op.drop_column('tournaments', 'is_archived')

    op.alter_column('tournaments', 'end_date',
               existing_type=sa.Date(),
               type_=postgresql.TIMESTAMP(timezone=True),
               existing_nullable=False)
    op.alter_column('tournaments', 'start_date',
               existing_type=sa.Date(),
               type_=postgresql.TIMESTAMP(timezone=True),
               existing_nullable=False)

    op.alter_column('tournaments', 'end_date',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               nullable=True)
    op.alter_column('tournaments', 'start_date',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               nullable=True)
    op.drop_column('tournaments', 'division')
    op.drop_column('tournaments', 'level')
    op.drop_column('tournaments', 'state')
    op.drop_column('tournaments', 'short_name')

    op.drop_column('tournaments', 'is_verified')
    op.drop_column('tournaments', 'is_public')

    op.drop_constraint('fk_tournament_memberships_join_code_id', 'tournament_memberships', type_='foreignkey')
    op.drop_column('tournament_memberships', 'join_code_id')
    op.drop_column('tournament_memberships', 'source')

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
        INSERT INTO chapter_join_codes
            (chapter_id, created_by, code, label, expires_at, is_active, created_at, use_count)
        SELECT chapter_id, created_by, code, label, expires_at, is_active, created_at, use_count
        FROM join_codes WHERE chapter_id IS NOT NULL
    """)
    op.drop_table('join_codes')

    op.add_column('tournaments', sa.Column('blocks', postgresql.JSON(astext_type=sa.Text()), autoincrement=False, nullable=False, server_default='[]'))
    op.add_column('tournaments', sa.Column('volunteer_schema', postgresql.JSON(astext_type=sa.Text()), autoincrement=False, nullable=False, server_default='{}'))
    op.alter_column('tournaments', 'blocks', server_default=None)
    op.alter_column('tournaments', 'volunteer_schema', server_default=None)
    op.add_column('tournament_memberships', sa.Column('positions', postgresql.JSON(astext_type=sa.Text()), autoincrement=False, nullable=True))

    op.drop_table('audit_log_entries')

    op.drop_index(op.f('ix_tournament_membership_roles_id'), table_name='tournament_membership_roles')
    op.drop_table('tournament_membership_roles')

    op.drop_index(op.f('ix_tournament_roles_id'), table_name='tournament_roles')
    op.drop_table('tournament_roles')
