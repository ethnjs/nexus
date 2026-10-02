"""user delete keeps history: SET NULL on credit FKs to users

Revision ID: b4e8d2f1a7c3
Revises: 9777a35487d8
Create Date: 2026-10-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4e8d2f1a7c3'
down_revision: Union[str, None] = '9777a35487d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (table, column) pairs that credit a user for something which outlives them.
# Created unnamed, so Postgres named them {table}_{column}_fkey.
_CREDIT_FKS = [
    ("tournaments", "owner_id"),
    ("join_codes", "created_by"),
    ("audit_log_entries", "actor_id"),
    ("forms", "created_by"),
]


def upgrade() -> None:
    for table, column in _CREDIT_FKS:
        name = f"{table}_{column}_fkey"
        op.alter_column(table, column, existing_type=sa.Integer(), nullable=True)
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(name, table, "users", [column], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    # Fails if a deleted user left any of these null — there's no owner to
    # restore, so that's a data decision, not something to guess at here.
    for table, column in _CREDIT_FKS:
        name = f"{table}_{column}_fkey"
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(name, table, "users", [column], ["id"])
        op.alter_column(table, column, existing_type=sa.Integer(), nullable=False)
