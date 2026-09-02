"""widen lunch value/label for free-text answers

Revision ID: a1c4f2b90d17
Revises: 582be5286725
Create Date: 2026-09-02

lunch_{date}_{category} now allows short_text/long_text questions, whose
answer is written through as the row's value/label. VARCHAR(64)/VARCHAR(255)
were sized for option text and would raise on a long answer, so both become
unbounded Text. Widening only — every existing row still fits.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c4f2b90d17'
down_revision: Union[str, None] = '582be5286725'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "tournament_membership_lunch", "value",
        existing_type=sa.String(length=64), type_=sa.Text(), existing_nullable=False,
    )
    op.alter_column(
        "tournament_membership_lunch", "label",
        existing_type=sa.String(length=255), type_=sa.Text(), existing_nullable=False,
    )


def downgrade() -> None:
    # Narrowing back truncates anything longer than the old limits — the
    # USING clause makes that explicit rather than letting the cast fail.
    op.alter_column(
        "tournament_membership_lunch", "value",
        existing_type=sa.Text(), type_=sa.String(length=64), existing_nullable=False,
        postgresql_using="left(value, 64)",
    )
    op.alter_column(
        "tournament_membership_lunch", "label",
        existing_type=sa.Text(), type_=sa.String(length=255), existing_nullable=False,
        postgresql_using="left(label, 255)",
    )
