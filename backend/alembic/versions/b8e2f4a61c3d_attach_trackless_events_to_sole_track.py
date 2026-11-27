"""attach trackless events to a single-track tournament's track

Revision ID: b8e2f4a61c3d
Revises: a4c91d7e3b52
Create Date: 2026-11-26

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8e2f4a61c3d"
down_revision: str | Sequence[str] | None = "a4c91d7e3b52"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# A single-track tournament's UI has no track controls, so an event on no
# track there could never be placed or staffed. Mirrors attach_trackless_events.
def upgrade() -> None:
    op.execute(
        "INSERT INTO tournament_event_tracks (tournament_event_id, track_id) "
        "SELECT e.id, t.id FROM tournament_events e "
        "JOIN tournament_tracks t "
        "ON t.tournament_id = e.tournament_id AND t.is_archived = false "
        "WHERE NOT EXISTS ("
        "SELECT 1 FROM tournament_event_tracks et WHERE et.tournament_event_id = e.id"
        ") AND ("
        "SELECT count(*) FROM tournament_tracks t2 "
        "WHERE t2.tournament_id = e.tournament_id AND t2.is_archived = false"
        ") = 1"
    )


# The added rows can't be told apart from ones a TD made.
def downgrade() -> None:
    pass
