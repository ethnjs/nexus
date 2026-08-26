"""tournament forms and onboarded_at

Revision ID: 8d55ec2b6640
Revises: 7db31ae17e3c
Create Date: 2026-08-25 00:00:00.000000

Adds tournament_forms — a 1:1 companion row every tournament-scoped Form
gets (owner_type == "tournament"; chapter forms never get one). is_onboarding
+ order (order only meaningful for is_onboarding=True rows) drive the
onboarding step sequence for a tournament. See the TournamentForm model
docstring in app/models/models.py for the full design.

Also adds tournament_memberships.onboarded_at, set once a member has
answered every currently-onboarding-flagged published form.

Backfills a tournament_forms row for every existing forms row that already
has a tournament_id, so the 1:1 invariant holds for pre-existing data too.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '8d55ec2b6640'
down_revision: Union[str, None] = '7db31ae17e3c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('tournament_forms',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=False),
    sa.Column('form_id', sa.String(length=12), nullable=False),
    sa.Column('is_onboarding', sa.Boolean(), nullable=False),
    sa.Column('order', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['form_id'], ['forms.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('form_id', name='uq_tournament_form_form')
    )
    op.create_index(op.f('ix_tournament_forms_id'), 'tournament_forms', ['id'], unique=False)

    op.add_column('tournament_memberships', sa.Column('onboarded_at', sa.DateTime(timezone=True), nullable=True))

    # Backfill: every pre-existing tournament-owned form needs its
    # companion row too, or the 1:1 invariant is broken from day one.
    op.execute(
        """
        INSERT INTO tournament_forms (tournament_id, form_id, is_onboarding, created_at)
        SELECT tournament_id, id, false, now()
        FROM forms
        WHERE tournament_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_column('tournament_memberships', 'onboarded_at')
    op.drop_index(op.f('ix_tournament_forms_id'), table_name='tournament_forms')
    op.drop_table('tournament_forms')
