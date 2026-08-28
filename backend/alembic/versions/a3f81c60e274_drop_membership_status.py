"""drop membership status

Revision ID: a3f81c60e274
Revises: 066d0807d514
Create Date: 2026-08-28 15:02:00.000000

TournamentMembership.status ("interested" | "confirmed") is superseded by
per-track statuses: one tournament-wide flag can't express a member who is
confirmed on one track and declined on another, which is what complex
tournaments actually need. See tournament_membership_track_statuses.

The column gated nothing and was effectively write-only — set at join and at
tournament creation, then never moved (mark_confirmed, its only mutator, had
zero callers). Nothing to migrate into the new table: an "interested" here
never named a track, so there's no per-track fact to recover from it.

Irreversible in practice — downgrade recreates the column with the old default
rather than the values it held.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a3f81c60e274'
down_revision: Union[str, None] = '066d0807d514'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('tournament_memberships', 'status')


def downgrade() -> None:
    op.add_column(
        'tournament_memberships',
        sa.Column('status', sa.String(length=32), nullable=False, server_default='interested'),
    )
    op.alter_column('tournament_memberships', 'status', server_default=None)
