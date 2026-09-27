"""add oauth_identities

Revision ID: a4e8c1b90d27
Revises: d3b71a4c9e02
Create Date: 2026-09-27 04:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a4e8c1b90d27"
down_revision: Union[str, None] = "d3b71a4c9e02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    oauth_provider = postgresql.ENUM("google", name="oauth_provider", create_type=False)
    oauth_provider.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "oauth_identities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider", postgresql.ENUM("google", name="oauth_provider", create_type=False), nullable=False),
        sa.Column("provider_account_id", sa.String(length=255), nullable=False),
        sa.Column("email_at_provider", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_account_id", name="uq_oauth_identity_provider_account"),
        sa.UniqueConstraint("provider", "user_id", name="uq_oauth_identity_provider_user"),
    )
    op.create_index(op.f("ix_oauth_identities_id"), "oauth_identities", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_oauth_identities_id"), table_name="oauth_identities")
    op.drop_table("oauth_identities")
    # Autogenerate leaves the enum type behind.
    sa.Enum(name="oauth_provider").drop(op.get_bind(), checkfirst=True)
