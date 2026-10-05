"""name each simple tournament's sole track after the tournament

Revision ID: 8a438a1a14a3
Revises: 90c29492df5b
Create Date: 2026-10-05

Data only. A tournament with exactly one live track names that track after
itself — its short name, else its name (see sync_sole_track_name). Every
write path keeps that true from here on; this brings existing tournaments in
line once. A track whose target name is already held by one of the
tournament's pending-delete tracks is left alone, as the sync leaves it.

Downgrade is a no-op: the old names aren't recorded anywhere, and the new
ones are valid under the old code.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8a438a1a14a3'
down_revision: Union[str, None] = '90c29492df5b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("""
        UPDATE tournament_tracks AS track
        SET name = COALESCE(NULLIF(TRIM(t.short_name), ''), t.name)
        FROM tournaments AS t
        WHERE track.tournament_id = t.id
          AND track.is_archived = false
          AND track.name <> COALESCE(NULLIF(TRIM(t.short_name), ''), t.name)
          AND (
              SELECT COUNT(*) FROM tournament_tracks AS live
              WHERE live.tournament_id = t.id AND live.is_archived = false
          ) = 1
          AND NOT EXISTS (
              SELECT 1 FROM tournament_tracks AS other
              WHERE other.tournament_id = t.id
                AND other.id <> track.id
                AND other.name = COALESCE(NULLIF(TRIM(t.short_name), ''), t.name)
          )
    """))


def downgrade() -> None:
    pass
