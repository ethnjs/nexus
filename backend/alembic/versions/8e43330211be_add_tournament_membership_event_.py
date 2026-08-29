"""add tournament membership event preferences

Revision ID: 8e43330211be
Revises: a3f81c60e274
Create Date: 2026-08-28 00:00:00.000000

Write-through target for event_preference_* answers. One row per
(membership, key, event) — an event can only appear in one option per field
(see validate_event_preference_options) and a ranked_choice event_preference
field is required to have allow_duplicates=false, so rank is stored per row
but isn't part of the uniqueness.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '8e43330211be'
down_revision: Union[str, None] = 'a3f81c60e274'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tournament_membership_event_preferences',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('membership_id', sa.Integer(), nullable=False),
        sa.Column('tournament_event_id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(length=64), nullable=False),
        sa.Column('rank', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['membership_id'], ['tournament_memberships.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tournament_event_id'], ['tournament_events.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('membership_id', 'key', 'tournament_event_id', name='uq_membership_event_preference'),
    )
    op.create_index(
        op.f('ix_tournament_membership_event_preferences_id'),
        'tournament_membership_event_preferences', ['id'], unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_tournament_membership_event_preferences_id'),
        table_name='tournament_membership_event_preferences',
    )
    op.drop_table('tournament_membership_event_preferences')
