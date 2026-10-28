"""add form answer answered_at

Revision ID: d997385d3370
Revises: c7a6ecd30321
Create Date: 2026-10-27 17:46:42.746278

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d997385d3370"
down_revision: str | Sequence[str] | None = "c7a6ecd30321"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# An existing answer's real time isn't recorded; its response's last update is
# the closest bound, and never earlier than the answer.
def upgrade() -> None:
    op.add_column("form_answers", sa.Column("answered_at", sa.DateTime(timezone=True)))
    op.execute(
        "UPDATE form_answers SET answered_at = form_responses.updated_at "
        "FROM form_responses WHERE form_responses.id = form_answers.response_id"
    )
    op.alter_column("form_answers", "answered_at", nullable=False)


def downgrade() -> None:
    op.drop_column("form_answers", "answered_at")
