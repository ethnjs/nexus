"""add answer semantics and pivot pending updates to field_id

Phase 1 of the form edit lifecycle work (see backend/form-edit-lifecycle.md).

Two changes:
  * FormAnswer records the question_type/field_key it was answered under, so a
    stored answer stays readable after its field is edited.
  * FormResponsePendingUpdate keys on field_id instead of field_key. A key is
    a TD-editable display name; keying history on it strands the flag the
    moment the question is renamed.

Revision ID: 00bf7c99a668
Revises: 8d55ec2b6640
Create Date: 2026-08-26 21:00:55.083705

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '00bf7c99a668'
down_revision: Union[str, None] = '8d55ec2b6640'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('form_answers', sa.Column('question_type', sa.String(length=32), nullable=True))
    op.add_column('form_answers', sa.Column('field_key', sa.String(length=64), nullable=True))

    # Backfill from each answer's field as it looks *now*. Correct for any
    # field untouched since the answer was given, approximate otherwise —
    # there's no record of the field's past shape, which is the gap these
    # columns close going forward.
    op.execute("""
        UPDATE form_answers a
        SET question_type = f.question_type,
            field_key = f.field_key
        FROM form_fields f
        WHERE f.id = a.field_id
    """)

    op.add_column('form_response_pending_updates', sa.Column('field_id', sa.String(length=12), nullable=True))

    # Resolve each flag's field_key to a field on the same form. Prefer the
    # live one: a removed field keeps its key while archived, so a key can be
    # held by both an archived row and its replacement — the flag refers to
    # whichever the respondent can actually answer.
    op.execute("""
        UPDATE form_response_pending_updates p
        SET field_id = (
            SELECT f.id
            FROM form_fields f
            WHERE f.form_id = (
                    SELECT r.form_id FROM form_responses r WHERE r.id = p.response_id
                )
              AND f.field_key = p.field_key
            ORDER BY f.is_archived ASC, f.id ASC
            LIMIT 1
        )
    """)

    # A flag whose key resolves to nothing points at a field that no longer
    # exists, so it could never be cleared by answering anything. Drop it
    # rather than block the NOT NULL below.
    op.execute("DELETE FROM form_response_pending_updates WHERE field_id IS NULL")

    op.alter_column('form_response_pending_updates', 'field_id', nullable=False)
    op.create_foreign_key(
        'fk_pending_update_field_id', 'form_response_pending_updates', 'form_fields',
        ['field_id'], ['id'], ondelete='CASCADE',
    )

    op.drop_constraint('uq_pending_update_per_response_field', 'form_response_pending_updates', type_='unique')
    op.drop_column('form_response_pending_updates', 'field_key')
    op.create_unique_constraint(
        'uq_pending_update_per_response_field', 'form_response_pending_updates', ['response_id', 'field_id']
    )


def downgrade() -> None:
    op.add_column('form_response_pending_updates', sa.Column('field_key', sa.String(length=64), nullable=True))
    op.execute("""
        UPDATE form_response_pending_updates p
        SET field_key = f.field_key
        FROM form_fields f
        WHERE f.id = p.field_id
    """)
    op.execute("DELETE FROM form_response_pending_updates WHERE field_key IS NULL")
    op.alter_column('form_response_pending_updates', 'field_key', nullable=False)

    op.drop_constraint('uq_pending_update_per_response_field', 'form_response_pending_updates', type_='unique')
    op.drop_constraint('fk_pending_update_field_id', 'form_response_pending_updates', type_='foreignkey')
    op.drop_column('form_response_pending_updates', 'field_id')
    op.create_unique_constraint(
        'uq_pending_update_per_response_field', 'form_response_pending_updates', ['response_id', 'field_key']
    )

    op.drop_column('form_answers', 'field_key')
    op.drop_column('form_answers', 'question_type')
