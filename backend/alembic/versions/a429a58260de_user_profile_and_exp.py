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
    # --- users: column changes (add dob, pronouns, etc.) ---
    op.add_column('users', sa.Column('date_of_birth', sa.Date(), nullable=True))
    op.add_column('users', sa.Column('pronouns', sa.String(length=100), nullable=True))
    op.add_column('users', sa.Column('has_competition_experience', sa.Boolean(), nullable=True))
    op.add_column('users', sa.Column('has_volunteer_experience', sa.Boolean(), nullable=True))
    op.drop_column('users', 'competition_exp')
    op.drop_column('users', 'volunteering_exp')

    # --- rename old tournament-scoped events → tournament_events ---
    op.rename_table('events', 'tournament_events')
    op.drop_index('ix_events_id', table_name='tournament_events')
    op.create_index('ix_tournament_events_id', 'tournament_events', ['id'], unique=False)

    # --- rename memberships → tournament_memberships ---
    op.rename_table('memberships', 'tournament_memberships')
    op.drop_index('ix_memberships_id', table_name='tournament_memberships')
    op.create_index('ix_tournament_memberships_id', 'tournament_memberships', ['id'], unique=False)

    # --- canonical event_categories table ---
    op.create_table(
        'event_categories',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_event_categories_id', 'event_categories', ['id'], unique=False)

    # --- canonical events table ---
    op.create_table(
        'events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('category_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['category_id'], ['event_categories.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_events_id', 'events', ['id'], unique=False)

    # --- user_competition_experience table ---
    op.create_table(
        'user_competition_experience',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('event_id', sa.Integer(), nullable=False),
        sa.Column('school', sa.String(length=255), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_user_competition_experience_id', 'user_competition_experience', ['id'], unique=False)


def downgrade() -> None:
    # --- drop user_competition_experience ---
    op.drop_index('ix_user_competition_experience_id', table_name='user_competition_experience')
    op.drop_table('user_competition_experience')

    # --- drop canonical events ---
    op.drop_index('ix_events_id', table_name='events')
    op.drop_table('events')
    op.drop_index('ix_event_categories_id', table_name='event_categories')
    op.drop_table('event_categories')

    # --- rename tournament_memberships → memberships ---
    op.rename_table('tournament_memberships', 'memberships')
    op.drop_index('ix_tournament_memberships_id', table_name='memberships')
    op.create_index('ix_memberships_id', 'memberships', ['id'], unique=False)

    # --- rename tournament_events → events ---
    op.rename_table('tournament_events', 'events')
    op.drop_index('ix_tournament_events_id', table_name='events')
    op.create_index('ix_events_id', 'events', ['id'], unique=False)

    # --- users: reverse users column changes (dob, pronouns, etc.) ---
    op.add_column('users', sa.Column('volunteering_exp', sa.TEXT(), nullable=True))
    op.add_column('users', sa.Column('competition_exp', sa.TEXT(), nullable=True))
    op.drop_column('users', 'has_volunteer_experience')
    op.drop_column('users', 'has_competition_experience')
    op.drop_column('users', 'pronouns')
    op.drop_column('users', 'date_of_birth')
