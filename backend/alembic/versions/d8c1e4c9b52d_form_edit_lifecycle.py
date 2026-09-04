"""form edit lifecycle

Schema for backend/form-edit-lifecycle.md — fields are edited in place rather
than archived and replaced, so identity moves off field_key onto field_id.

  * FormAnswer records the question_type/field_key it was answered under.
    `value`'s shape is a function of both, so an answer stays readable after
    its field is edited instead of being reinterpreted through the new shape.
  * FormResponsePendingUpdate keys on field_id, not field_key — a key is a
    TD-editable display name, and keying history on it strands the flag the
    moment a question is renamed. `reason` becomes a `reasons` set, since one
    save can raise several on the same field.
  * field_key uniqueness narrows to live fields, and the `_archived_` name
    mangling that existed to free a key for a replacement is undone.

Revision ID: d8c1e4c9b52d
Revises: 8d55ec2b6640
Create Date: 2026-08-27 01:03:18.442071

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd8c1e4c9b52d'
down_revision: Union[str, None] = '8d55ec2b6640'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The old mangle was f"{key}_archived_{id}" with '-' swapped for '_' (field_key
# rejects hyphens). Matching each row against its own id keeps this exact — a
# TD-authored key that merely looks mangled is left alone.
_SUFFIX = "'_archived_' || replace(f.id, '-', '_')"


def upgrade() -> None:
    # --- FormAnswer: record the semantics each answer was given under ------
    op.add_column('form_answers', sa.Column('question_type', sa.String(length=32), nullable=True))
    op.add_column('form_answers', sa.Column('field_key', sa.String(length=64), nullable=True))

    # Backfilled from each answer's field as it looks *now*: correct for any
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

    # --- FormResponsePendingUpdate: field_key -> field_id, reason -> reasons
    op.add_column('form_response_pending_updates', sa.Column('field_id', sa.String(length=12), nullable=True))
    op.add_column('form_response_pending_updates', sa.Column('reasons', sa.JSON(), nullable=True))

    # Resolved before the un-mangling below, so each key still matches exactly
    # one field: an archived row is still carrying its mangled name here, and
    # only the live field holds the key the flag refers to.
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

    # Map the old pair onto the new vocabulary. field_replaced came from a
    # question_type change or a removal; removals no longer flag at all, so
    # every surviving row of that kind is a type change.
    op.execute("""
        UPDATE form_response_pending_updates
        SET reasons = CASE reason
            WHEN 'option_archived' THEN '["option_invalidated"]'::json
            ELSE '["question_type_changed"]'::json
        END
    """)

    # A flag whose key resolves to nothing points at a field that no longer
    # exists, so it could never be cleared by answering anything.
    op.execute("DELETE FROM form_response_pending_updates WHERE field_id IS NULL")

    op.alter_column('form_response_pending_updates', 'field_id', nullable=False)
    op.alter_column('form_response_pending_updates', 'reasons', nullable=False)
    op.create_foreign_key(
        'fk_pending_update_field_id', 'form_response_pending_updates', 'form_fields',
        ['field_id'], ['id'], ondelete='CASCADE',
    )
    op.drop_constraint('uq_pending_update_per_response_field', 'form_response_pending_updates', type_='unique')
    op.drop_column('form_response_pending_updates', 'field_key')
    op.drop_column('form_response_pending_updates', 'reason')
    op.create_unique_constraint(
        'uq_pending_update_per_response_field', 'form_response_pending_updates', ['response_id', 'field_id']
    )

    # --- FormField: release archived keys ---------------------------------
    # Order matters. uq_form_field_key covers archived rows too, so un-mangling
    # under it would collide an archived field with the live one holding its
    # original key.
    op.drop_constraint('uq_form_field_key', 'form_fields', type_='unique')
    op.execute(f"""
        UPDATE form_fields f
        SET field_key = left(f.field_key, length(f.field_key) - length({_SUFFIX}))
        WHERE f.is_archived = true
          AND right(f.field_key, length({_SUFFIX})) = {_SUFFIX}
          AND length(f.field_key) > length({_SUFFIX})
    """)
    op.create_index(
        'uq_form_field_key', 'form_fields', ['form_id', 'field_key'],
        unique=True, postgresql_where=sa.text('is_archived = false'),
    )


def downgrade() -> None:
    op.drop_index('uq_form_field_key', table_name='form_fields')
    # Re-mangle every archived field, not just the ones upgrade() touched —
    # the old invariant is that no archived key collides with a live one, and
    # there's no record of which were originally mangled.
    op.execute(f"""
        UPDATE form_fields f
        SET field_key = f.field_key || {_SUFFIX}
        WHERE f.is_archived = true
          AND right(f.field_key, length({_SUFFIX})) <> {_SUFFIX}
    """)
    op.create_unique_constraint('uq_form_field_key', 'form_fields', ['form_id', 'field_key'])

    op.add_column('form_response_pending_updates', sa.Column('field_key', sa.String(length=64), nullable=True))
    op.add_column('form_response_pending_updates', sa.Column('reason', sa.String(length=32), nullable=True))
    op.execute("""
        UPDATE form_response_pending_updates p
        SET field_key = f.field_key
        FROM form_fields f
        WHERE f.id = p.field_id
    """)
    # Collapse to the single stronger value; reasons with no pre-lifecycle
    # equivalent are dropped.
    op.execute("""
        UPDATE form_response_pending_updates
        SET reason = CASE
            WHEN reasons::jsonb ? 'option_invalidated'
             AND jsonb_array_length(reasons::jsonb) = 1 THEN 'option_archived'
            ELSE 'field_replaced'
        END
    """)
    op.execute("DELETE FROM form_response_pending_updates WHERE field_key IS NULL")
    op.alter_column('form_response_pending_updates', 'field_key', nullable=False)
    op.alter_column('form_response_pending_updates', 'reason', nullable=False)

    op.drop_constraint('uq_pending_update_per_response_field', 'form_response_pending_updates', type_='unique')
    op.drop_constraint('fk_pending_update_field_id', 'form_response_pending_updates', type_='foreignkey')
    op.drop_column('form_response_pending_updates', 'reasons')
    op.drop_column('form_response_pending_updates', 'field_id')
    op.create_unique_constraint(
        'uq_pending_update_per_response_field', 'form_response_pending_updates', ['response_id', 'field_key']
    )

    op.drop_column('form_answers', 'field_key')
    op.drop_column('form_answers', 'question_type')
