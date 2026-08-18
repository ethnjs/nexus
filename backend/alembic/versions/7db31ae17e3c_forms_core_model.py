"""forms core model

Revision ID: 7db31ae17e3c
Revises: d3e4f5a6b7c8
Create Date: 2026-08-17 00:00:00.000000

Consolidates what were previously two migrations (form/form_fields, then
form_responses/form_answers) into one, now that the Form ownership model
has been reworked to many-to-many (FormTournament/FormChapter) before
either migration was ever applied anywhere. Local-dev-only history, so
squashing instead of layering a third migration on top of a broken shape.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '7db31ae17e3c'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('forms',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_forms_id'), 'forms', ['id'], unique=False)

    op.create_table('form_tournaments',
    sa.Column('form_id', sa.Integer(), nullable=False),
    sa.Column('tournament_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['form_id'], ['forms.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tournament_id'], ['tournaments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('form_id', 'tournament_id')
    )

    op.create_table('form_chapters',
    sa.Column('form_id', sa.Integer(), nullable=False),
    sa.Column('chapter_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['form_id'], ['forms.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['chapter_id'], ['alumni_chapters.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('form_id', 'chapter_id')
    )

    op.create_table('form_fields',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('form_id', sa.Integer(), nullable=False),
    sa.Column('order', sa.Integer(), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('question_type', sa.String(length=32), nullable=False),
    sa.Column('field_key', sa.String(length=64), nullable=True),
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
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('form_id', sa.Integer(), nullable=False),
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
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('response_id', sa.Integer(), nullable=False),
    sa.Column('field_id', sa.Integer(), nullable=False),
    sa.Column('value', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['field_id'], ['form_fields.id'], ),
    sa.ForeignKeyConstraint(['response_id'], ['form_responses.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('response_id', 'field_id', name='uq_answer_per_field')
    )
    op.create_index(op.f('ix_form_answers_id'), 'form_answers', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_form_answers_id'), table_name='form_answers')
    op.drop_table('form_answers')
    op.drop_index(op.f('ix_form_responses_id'), table_name='form_responses')
    op.drop_table('form_responses')
    op.drop_index(op.f('ix_form_fields_id'), table_name='form_fields')
    op.drop_table('form_fields')
    op.drop_table('form_chapters')
    op.drop_table('form_tournaments')
    op.drop_index(op.f('ix_forms_id'), table_name='forms')
    op.drop_table('forms')
