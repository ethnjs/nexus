"""forms core model

Revision ID: 7db31ae17e3c
Revises: d3e4f5a6b7c8
Create Date: 2026-08-17 00:00:00.000000

Consolidates what were previously two migrations (form/form_fields, then
form_responses/form_answers) into one. Local-dev-only history, so squashing
instead of layering a third migration on top of a broken shape. Form
ownership is single tournament-or-chapter (owner_type + CHECK constraint) —
multi-tournament "group forms" are a later, separate phase.

Also includes tournament_membership_availability and tournament_membership_lunch —
write-through targets for the "availability_{date}" and "lunch_{date}_{category}"
reserved field_keys. Squashed in here rather than a new migration, same
local-dev-only reasoning as above.

Also drops tournament_memberships' role_preference/event_preference/
availability/lunch_order/extra_data — deprecated manual-entry JSON columns,
superseded by the write-through tables above (availability, lunch) or the
native form-response flow queried directly (event_preference, role_preference
have no relational replacement, not currently needed by any read path).
Squashed into this migration rather than a new one, same reasoning.

form_fields/form_responses/form_answers.id (and the FK columns pointing at
them) are String(12) nanoids, not auto-increment ints — matching forms.id's
scheme (see generate_public_id in app/models/models.py). Edited in place
here rather than a new migration, same local-dev-only squashing reasoning as
above; there's no production data to preserve a conversion path for.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '7db31ae17e3c'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('forms',
    sa.Column('id', sa.String(length=12), nullable=False),
    sa.Column('owner_type', sa.String(length=16), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=True),
    sa.Column('chapter_id', sa.Integer(), nullable=True),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("(owner_type = 'tournament' AND tournament_id IS NOT NULL AND chapter_id IS NULL) OR (owner_type = 'chapter' AND chapter_id IS NOT NULL AND tournament_id IS NULL)", name='ck_form_owner_exclusive'),
    sa.ForeignKeyConstraint(['chapter_id'], ['alumni_chapters.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_forms_id'), 'forms', ['id'], unique=False)

    op.create_table('form_fields',
    sa.Column('id', sa.String(length=12), nullable=False),
    sa.Column('form_id', sa.String(length=12), nullable=False),
    sa.Column('order', sa.Integer(), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('question_type', sa.String(length=32), nullable=False),
    sa.Column('field_key', sa.String(length=64), nullable=False),
    sa.Column('config', sa.JSON(), nullable=True),
    sa.Column('is_archived', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['form_id'], ['forms.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('form_id', 'field_key', name='uq_form_field_key')
    )
    op.create_index(op.f('ix_form_fields_id'), 'form_fields', ['id'], unique=False)

    op.create_table('form_responses',
    sa.Column('id', sa.String(length=12), nullable=False),
    sa.Column('form_id', sa.String(length=12), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['form_id'], ['forms.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('form_id', 'user_id', name='uq_form_response_per_user')
    )
    op.create_index(op.f('ix_form_responses_id'), 'form_responses', ['id'], unique=False)

    op.create_table('form_answers',
    sa.Column('id', sa.String(length=12), nullable=False),
    sa.Column('response_id', sa.String(length=12), nullable=False),
    sa.Column('field_id', sa.String(length=12), nullable=False),
    sa.Column('value', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['field_id'], ['form_fields.id'], ),
    sa.ForeignKeyConstraint(['response_id'], ['form_responses.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('response_id', 'field_id', name='uq_answer_per_field')
    )
    op.create_index(op.f('ix_form_answers_id'), 'form_answers', ['id'], unique=False)

    op.create_table('tournament_membership_availability',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('membership_id', sa.Integer(), nullable=False),
    sa.Column('tournament_shift_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['membership_id'], ['tournament_memberships.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_shift_id'], ['tournament_shifts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('membership_id', 'tournament_shift_id', name='uq_membership_availability')
    )
    op.create_index(op.f('ix_tournament_membership_availability_id'), 'tournament_membership_availability', ['id'], unique=False)

    op.create_table('tournament_membership_lunch',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('membership_id', sa.Integer(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('category', sa.String(length=64), nullable=False),
    sa.Column('value', sa.String(length=64), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=False),
    sa.ForeignKeyConstraint(['membership_id'], ['tournament_memberships.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('membership_id', 'date', 'category', 'value', name='uq_membership_lunch_selection')
    )
    op.create_index(op.f('ix_tournament_membership_lunch_id'), 'tournament_membership_lunch', ['id'], unique=False)

    op.create_table('form_response_pending_updates',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('response_id', sa.String(length=12), nullable=False),
    sa.Column('field_key', sa.String(length=64), nullable=False),
    sa.Column('reason', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['response_id'], ['form_responses.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('response_id', 'field_key', name='uq_pending_update_per_response_field')
    )
    op.create_index(op.f('ix_form_response_pending_updates_id'), 'form_response_pending_updates', ['id'], unique=False)

    op.drop_column('tournament_memberships', 'role_preference')
    op.drop_column('tournament_memberships', 'event_preference')
    op.drop_column('tournament_memberships', 'availability')
    op.drop_column('tournament_memberships', 'lunch_order')
    op.drop_column('tournament_memberships', 'extra_data')


def downgrade() -> None:
    op.add_column('tournament_memberships', sa.Column('extra_data', sa.JSON(), nullable=True))
    op.add_column('tournament_memberships', sa.Column('lunch_order', sa.JSON(), nullable=True))
    op.add_column('tournament_memberships', sa.Column('availability', sa.JSON(), nullable=True))
    op.add_column('tournament_memberships', sa.Column('event_preference', sa.JSON(), nullable=True))
    op.add_column('tournament_memberships', sa.Column('role_preference', sa.JSON(), nullable=True))

    op.drop_index(op.f('ix_form_response_pending_updates_id'), table_name='form_response_pending_updates')
    op.drop_table('form_response_pending_updates')
    op.drop_index(op.f('ix_tournament_membership_lunch_id'), table_name='tournament_membership_lunch')
    op.drop_table('tournament_membership_lunch')
    op.drop_index(op.f('ix_tournament_membership_availability_id'), table_name='tournament_membership_availability')
    op.drop_table('tournament_membership_availability')
    op.drop_index(op.f('ix_form_answers_id'), table_name='form_answers')
    op.drop_table('form_answers')
    op.drop_index(op.f('ix_form_responses_id'), table_name='form_responses')
    op.drop_table('form_responses')
    op.drop_index(op.f('ix_form_fields_id'), table_name='form_fields')
    op.drop_table('form_fields')
    op.drop_index(op.f('ix_forms_id'), table_name='forms')
    op.drop_table('forms')
