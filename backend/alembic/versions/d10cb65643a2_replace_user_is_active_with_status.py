"""replace user is_active with status

Revision ID: d10cb65643a2
Revises: 8c1053c617c1
Create Date: 2026-07-27 10:51:09.714544

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd10cb65643a2'
down_revision: Union[str, None] = '8c1053c617c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('status', sa.String(length=32), nullable=True))

    conn = op.get_bind()

    # is_active=false with a password set has no producing code path today —
    # its correct status is ambiguous (deactivated? locked?), so refuse to
    # guess and halt instead.
    ambiguous = conn.execute(sa.text(
        "SELECT id FROM users WHERE is_active = false AND hashed_password IS NOT NULL"
    )).fetchall()
    if ambiguous:
        raise RuntimeError(
            f"Cannot backfill status: {len(ambiguous)} user(s) have is_active=false "
            f"with a password set (ids: {[r[0] for r in ambiguous]}). No existing code "
            "path produces this combination, so the correct status can't be inferred "
            "automatically — resolve manually before re-running this migration."
        )

    conn.execute(sa.text("UPDATE users SET status = 'active' WHERE is_active = true"))
    conn.execute(sa.text("UPDATE users SET status = 'invited' WHERE is_active = false"))

    op.alter_column('users', 'status', nullable=False)
    op.drop_column('users', 'is_active')


def downgrade() -> None:
    op.add_column('users', sa.Column('is_active', sa.Boolean(), nullable=True))

    conn = op.get_bind()
    conn.execute(sa.text("UPDATE users SET is_active = true WHERE status = 'active'"))
    conn.execute(sa.text("UPDATE users SET is_active = false WHERE status != 'active'"))

    op.alter_column('users', 'is_active', nullable=False)
    op.drop_column('users', 'status')
