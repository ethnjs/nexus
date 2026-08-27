"""unmangle archived field keys

Phase 2 of the form edit lifecycle work (see backend/form-edit-lifecycle.md).

Archived fields used to have their field_key rewritten to
`{key}_archived_{id}` so the replacement created by a question_type change
could inherit the original. Fields are now edited in place — there are no
replacements — and field_key uniqueness only applies to live fields, so the
mangled names have nothing left to avoid colliding with.

Must not run before uniqueness narrows to live fields: an archived
`interest_archived_abc123` un-mangles to `interest`, which the live row
created by its replacement already holds.

Revision ID: 30da722fb9b4
Revises: 00bf7c99a668
Create Date: 2026-08-26 22:14:03.117294

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '30da722fb9b4'
down_revision: Union[str, None] = '00bf7c99a668'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The mangle was f"{key}_archived_{id}" with '-' swapped for '_' (field_key's
# validator rejects hyphens). Matching on each row's own id rather than a
# regex keeps this exact — a TD-authored key that merely looks mangled is
# left alone.
_SUFFIX = "'_archived_' || replace(f.id, '-', '_')"


def upgrade() -> None:
    # Order matters. uq_form_field_key covers archived rows too, so
    # un-mangling under it would collide an archived field with the live one
    # holding its original key. Drop first, un-mangle, then re-add scoped to
    # live fields.
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

    # Re-mangle every archived field, not just the ones this migration
    # touched — the pre-Phase-2 invariant is that no archived key collides
    # with a live one, and there's no record of which were originally mangled.
    op.execute(f"""
        UPDATE form_fields f
        SET field_key = f.field_key || {_SUFFIX}
        WHERE f.is_archived = true
          AND right(f.field_key, length({_SUFFIX})) <> {_SUFFIX}
    """)

    op.create_unique_constraint('uq_form_field_key', 'form_fields', ['form_id', 'field_key'])
