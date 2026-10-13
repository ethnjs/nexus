"""make auto-set timestamp columns not null

Revision ID: 63863039d4f1
Revises: c4a91d7e2f63
Create Date: 2026-10-13 14:30:25.488718

"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "63863039d4f1"
down_revision: str | Sequence[str] | None = "c4a91d7e2f63"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (table, column, fallback). The ORM always sets these, but a row inserted by raw
# SQL could be NULL; it takes the fallback column's value if any, else now().
COLUMNS = [
    ("alumni_chapters", "created_at", None),
    ("audit_log_entries", "created_at", None),
    ("chapter_memberships", "joined_at", None),
    ("form_fields", "created_at", None),
    ("form_fields", "updated_at", "created_at"),
    ("form_response_pending_updates", "created_at", None),
    ("form_responses", "submitted_at", None),
    ("form_responses", "updated_at", "submitted_at"),
    ("forms", "created_at", None),
    ("forms", "updated_at", "created_at"),
    ("join_codes", "created_at", None),
    ("season_events", "created_at", None),
    ("sessions", "created_at", None),
    ("sessions", "last_active_at", "created_at"),
    ("tournament_forms", "created_at", None),
    ("tournament_membership_track_statuses", "created_at", None),
    ("tournament_membership_track_statuses", "updated_at", "created_at"),
    ("tournament_roles", "created_at", None),
    ("tournament_roles", "updated_at", "created_at"),
    ("tournament_shifts", "created_at", None),
    ("tournament_shifts", "updated_at", "created_at"),
    ("tournament_tracks", "created_at", None),
    ("tournament_tracks", "updated_at", "created_at"),
    ("verification_tokens", "created_at", None),
]


def upgrade() -> None:
    for table, column, fallback in COLUMNS:
        value = f"COALESCE({fallback}, now())" if fallback else "now()"
        op.execute(f"UPDATE {table} SET {column} = {value} WHERE {column} IS NULL")
        op.alter_column(
            table, column, existing_type=postgresql.TIMESTAMP(timezone=True), nullable=False
        )


def downgrade() -> None:
    for table, column, _ in reversed(COLUMNS):
        op.alter_column(
            table, column, existing_type=postgresql.TIMESTAMP(timezone=True), nullable=True
        )
