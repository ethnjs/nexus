"""add event_relationships

Revision ID: c41e8b7d2a96
Revises: a7d4e2c9b315
Create Date: 2026-11-06

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c41e8b7d2a96"
down_revision: str | None = "a7d4e2c9b315"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "event_relationships",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("related_event_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("event_id < related_event_id", name="ck_event_relationship_order"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["related_event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "related_event_id", name="uq_event_relationship"),
    )
    op.create_index(op.f("ix_event_relationships_id"), "event_relationships", ["id"], unique=False)
    op.create_index(
        op.f("ix_event_relationships_related_event_id"),
        "event_relationships",
        ["related_event_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_event_relationships_related_event_id"), table_name="event_relationships")
    op.drop_index(op.f("ix_event_relationships_id"), table_name="event_relationships")
    op.drop_table("event_relationships")
