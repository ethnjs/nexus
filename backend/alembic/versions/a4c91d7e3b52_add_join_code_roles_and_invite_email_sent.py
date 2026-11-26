"""add join_code_roles and rename staff_invite_sent to invite_email_sent

Creates the join_code_roles bridge table, and rewrites every staff_invite_sent
audit entry ({emails, join_code, failed}) as invite_email_sent
({join_code, label, recipients: [{email, status}]}). The label is read from
the join code as it is now, since the old entries didn't record it.

Revision ID: a4c91d7e3b52
Revises: f7a3d8e2c614
Create Date: 2026-11-26

"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a4c91d7e3b52"
down_revision: str | Sequence[str] | None = "f7a3d8e2c614"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "join_code_roles",
        sa.Column("join_code_id", sa.Integer(), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["join_code_id"], ["join_codes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["tournament_roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("join_code_id", "role_id"),
    )

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT e.id, e.extra_data, j.label FROM audit_log_entries e "
            "LEFT JOIN join_codes j ON j.id = e.target_id "
            "WHERE e.action = 'staff_invite_sent'"
        )
    ).all()
    for entry_id, extra_data, label in rows:
        data = extra_data if isinstance(extra_data, dict) else json.loads(extra_data or "{}")
        failed = set(data.get("failed") or [])
        new_data = {
            "join_code": data.get("join_code"),
            "label": label,
            "recipients": [
                {"email": email, "status": "failed" if email in failed else "sent"}
                for email in data.get("emails") or []
            ],
        }
        conn.execute(
            sa.text(
                "UPDATE audit_log_entries SET action = 'invite_email_sent', "
                "extra_data = CAST(:data AS json) WHERE id = :id"
            ),
            {"data": json.dumps(new_data), "id": entry_id},
        )


def downgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, extra_data FROM audit_log_entries WHERE action = 'invite_email_sent'")
    ).all()
    for entry_id, extra_data in rows:
        data = extra_data if isinstance(extra_data, dict) else json.loads(extra_data or "{}")
        recipients = data.get("recipients") or []
        old_data: dict = {
            "emails": [r["email"] for r in recipients],
            "join_code": data.get("join_code"),
        }
        failed = [r["email"] for r in recipients if r["status"] == "failed"]
        if failed:
            old_data["failed"] = failed
        conn.execute(
            sa.text(
                "UPDATE audit_log_entries SET action = 'staff_invite_sent', "
                "extra_data = CAST(:data AS json) WHERE id = :id"
            ),
            {"data": json.dumps(old_data), "id": entry_id},
        )

    op.drop_table("join_code_roles")
