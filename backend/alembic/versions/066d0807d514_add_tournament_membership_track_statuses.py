"""add tournament membership track statuses

Revision ID: 066d0807d514
Revises: d8c1e4c9b52d
Create Date: 2026-08-28 14:16:15.320805

Write-through target for track_status_* answers (and opted-in availability_*
answers). One row per (membership, track).

Autogenerate also picked up pre-existing drift between the models and the dev
database — a dropped ix_forms_id index and a batch of created_at/updated_at
nullability flips on unrelated tables. Those are not this change and were
stripped out; they need their own revision if they're real.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '066d0807d514'
down_revision: Union[str, None] = 'd8c1e4c9b52d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tournament_membership_track_statuses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('membership_id', sa.Integer(), nullable=False),
        sa.Column('track_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('source_response_id', sa.String(length=12), nullable=True),
        sa.Column('source_field_id', sa.String(length=12), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['membership_id'], ['tournament_memberships.id'], ondelete='CASCADE'),
        # SET NULL, not CASCADE: invalidating the question that set a status
        # must not delete the status. See backend/form-edit-lifecycle.md.
        sa.ForeignKeyConstraint(['source_field_id'], ['form_fields.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['source_response_id'], ['form_responses.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['track_id'], ['tournament_tracks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('membership_id', 'track_id', name='uq_membership_track_status'),
    )
    op.create_index(
        op.f('ix_tournament_membership_track_statuses_id'),
        'tournament_membership_track_statuses', ['id'], unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_tournament_membership_track_statuses_id'),
        table_name='tournament_membership_track_statuses',
    )
    op.drop_table('tournament_membership_track_statuses')
