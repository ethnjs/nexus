"""store availability track statuses as a list

Revision ID: dcd0a5f34632
Revises: fd68532fea68
Create Date: 2026-10-18 21:23:23.752108

"""

import json
import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "dcd0a5f34632"
down_revision: str | Sequence[str] | None = "fd68532fea68"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AVAILABILITY_KEY = re.compile(r"^availability_(\d+)")


# An opted-in availability option carried one `track_status` for the track in
# its field's key; it now carries `track_statuses`, a list that can name any
# track. Archived fields are rewritten too, since unarchiving revalidates them.
def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, field_key, config FROM form_fields WHERE field_key LIKE 'availability_%'"
        )
    ).fetchall()
    for field_id, field_key, config in rows:
        match = AVAILABILITY_KEY.match(field_key)
        parsed = config if isinstance(config, dict) else (json.loads(config) if config else None)
        if not match or not isinstance(parsed, dict):
            continue
        track_id = int(match.group(1))
        changed = False
        for option in parsed.get("options") or []:
            value = option.get("value")
            if isinstance(value, dict) and "track_status" in value:
                status = value.pop("track_status")
                value["track_statuses"] = [{"id": track_id, "status": status}] if status else []
                changed = True
        if changed:
            conn.execute(
                sa.text("UPDATE form_fields SET config = CAST(:c AS json) WHERE id = :i"),
                {"c": json.dumps(parsed), "i": field_id},
            )


def downgrade() -> None:
    pass
