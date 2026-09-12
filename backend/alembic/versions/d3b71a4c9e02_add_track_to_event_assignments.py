"""add tournament_track_id to event assignments

Which track a staffing row is for. Derivable from the shift when there is
one, and otherwise unrecorded until now — a cosmetic track (Test Writing) has
no shifts by construction, so an unpinned assignment named no track at all and
the board could only guess by matching the row's role against each track's
default.

Denormalized on purpose: the copy is made unfalsifiable by a composite FK
against (shift.id, shift.track_id) rather than trusted to the write paths, the
same way membership_role_id is already paired with membership_id here.

Revision ID: d3b71a4c9e02
Revises: c018f2ae8e71
"""
from alembic import op
import sqlalchemy as sa

revision = "d3b71a4c9e02"
down_revision = "c018f2ae8e71"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # (id, track_id) is redundant on its own — id is the PK — and exists only
    # so the composite FK below has something to reference.
    op.create_unique_constraint(
        "uq_tournament_shift_id_track", "tournament_shifts", ["id", "track_id"],
    )

    op.add_column(
        "tournament_event_assignments",
        sa.Column("tournament_track_id", sa.Integer(), nullable=True),
    )

    # --- backfill -----------------------------------------------------------
    # A pinned row's answer is not a guess: its shift names the track.
    op.execute("""
        UPDATE tournament_event_assignments a
           SET tournament_track_id = s.track_id
          FROM tournament_shifts s
         WHERE a.tournament_shift_id = s.id
    """)

    # An unpinned row has no such record, so this reconstructs it the only way
    # the data allows — the same role match the board has been rendering with.
    # Ambiguous by nature (two tracks can share a default role); the ORDER BY
    # makes it at least deterministic.
    op.execute("""
        UPDATE tournament_event_assignments a
           SET tournament_track_id = (
               SELECT t.id
                 FROM tournament_event_tracks et
                 JOIN tournament_tracks t ON t.id = et.track_id
                 JOIN tournament_membership_roles mr ON mr.id = a.membership_role_id
                WHERE et.tournament_event_id = a.tournament_event_id
                  AND t.is_primary = false
                  AND t.default_role_id = mr.role_id
                ORDER BY t.id
                LIMIT 1
           )
         WHERE a.tournament_track_id IS NULL
    """)

    # Whatever the role match couldn't place: the event's first cosmetic
    # track, then any track it runs on, then the tournament's first primary
    # track. The column is NOT NULL, so every row needs an answer — and a row
    # that reaches the last of these is one nothing in the data could
    # attribute, which was equally true before this migration.
    op.execute("""
        UPDATE tournament_event_assignments a
           SET tournament_track_id = COALESCE(
               (SELECT t.id FROM tournament_event_tracks et
                  JOIN tournament_tracks t ON t.id = et.track_id
                 WHERE et.tournament_event_id = a.tournament_event_id
                   AND t.is_primary = false
                 ORDER BY t.id LIMIT 1),
               (SELECT t.id FROM tournament_event_tracks et
                  JOIN tournament_tracks t ON t.id = et.track_id
                 WHERE et.tournament_event_id = a.tournament_event_id
                 ORDER BY t.id LIMIT 1),
               (SELECT t.id FROM tournament_tracks t
                  JOIN tournament_events e ON e.tournament_id = t.tournament_id
                 WHERE e.id = a.tournament_event_id
                   AND t.is_primary = true
                 ORDER BY t.start_date NULLS LAST, t.id LIMIT 1)
           )
         WHERE a.tournament_track_id IS NULL
    """)

    # A row still without one would have to belong to an event whose
    # tournament has no primary track, which the track invariant forbids.
    op.execute("DELETE FROM tournament_event_assignments WHERE tournament_track_id IS NULL")

    op.alter_column(
        "tournament_event_assignments", "tournament_track_id", nullable=False,
    )
    op.create_index(
        "ix_tournament_event_assignments_tournament_track_id",
        "tournament_event_assignments", ["tournament_track_id"],
    )
    op.create_foreign_key(
        "fk_assignment_track", "tournament_event_assignments", "tournament_tracks",
        ["tournament_track_id"], ["id"], ondelete="CASCADE",
    )

    # --- the shift's FK becomes the composite one ---------------------------
    op.drop_constraint(
        "tournament_event_assignments_tournament_shift_id_fkey",
        "tournament_event_assignments", type_="foreignkey",
    )
    op.create_foreign_key(
        "fk_assignment_shift_track", "tournament_event_assignments", "tournament_shifts",
        ["tournament_shift_id", "tournament_track_id"], ["id", "track_id"],
        ondelete="CASCADE",
    )

    # The unpinned uniqueness key gains the track: one person can hold the
    # same role on an event's Test Writing *and* its Test Reviewing, and
    # without the track those two rows collide.
    op.drop_index("uq_event_assignment_no_shift", table_name="tournament_event_assignments")
    op.create_index(
        "uq_event_assignment_no_shift",
        "tournament_event_assignments",
        ["tournament_event_id", "membership_role_id", "tournament_track_id"],
        unique=True,
        postgresql_where=sa.text("tournament_shift_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_event_assignment_no_shift", table_name="tournament_event_assignments")
    op.create_index(
        "uq_event_assignment_no_shift",
        "tournament_event_assignments",
        ["tournament_event_id", "membership_role_id"],
        unique=True,
        postgresql_where=sa.text("tournament_shift_id IS NULL"),
    )
    op.drop_constraint(
        "fk_assignment_shift_track", "tournament_event_assignments", type_="foreignkey",
    )
    op.create_foreign_key(
        "tournament_event_assignments_tournament_shift_id_fkey",
        "tournament_event_assignments", "tournament_shifts",
        ["tournament_shift_id"], ["id"], ondelete="CASCADE",
    )
    op.drop_constraint("fk_assignment_track", "tournament_event_assignments", type_="foreignkey")
    op.drop_index(
        "ix_tournament_event_assignments_tournament_track_id",
        table_name="tournament_event_assignments",
    )
    op.drop_column("tournament_event_assignments", "tournament_track_id")
    op.drop_constraint("uq_tournament_shift_id_track", "tournament_shifts", type_="unique")
