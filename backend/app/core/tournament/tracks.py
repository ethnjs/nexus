"""
Track lifecycle — the rules that keep a tournament's schedule coherent.

Two invariants drive everything here:

1. **A tournament always has at least one live primary track.** Its dates,
   venue and divisions are derived from those tracks (see Tournament's
   properties), so a tournament with none has no schedule at all.

2. **A track is only removed once nothing TD-authored points at it.**
   References split by who owns them:

   *TD-authored* — shifts and form fields. These block: silently deleting a
   TD's availability question because someone removed a track would destroy
   authored work, and the field would be left naming a track that no longer
   exists.

   *Member data* — track statuses, and (from B3) lunch and event-preference
   rows. These cascade: they only mean anything in the context of the track,
   so a track that's really going away takes them with it.

   So DELETE either removes the track outright or marks it pending
   (`is_archived`), and `purge_pending_tracks` finishes the job later, once
   the TD has repointed or removed the last blocking reference. That's why
   both transitions are audit-logged — the purge happens as a side effect of
   an unrelated edit, with no TD action naming the track.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.form import track_referenced_by_form_field
from app.core.tournament.audit import TRACK_PURGED, log_action
from app.models.models import TournamentMembershipTrackStatus, TournamentTrack


def track_blocking_references(db: Session, tournament_id: int, track_id: int) -> list[str]:
    """Human-readable TD-authored references that keep `track_id` alive.

    Empty means the track can be hard-deleted right now. The strings are
    surfaced straight to the TD in the delete response so they know what to
    repoint. Shifts join this list once they carry a track_id."""
    blockers: list[str] = []
    if track_referenced_by_form_field(db, tournament_id, track_id):
        blockers.append("a form field")
    return blockers


def track_member_data_count(db: Session, track_id: int) -> int:
    """How many member rows a hard delete would take with it. Shown before
    the fact so a TD deleting a track knows what it costs."""
    return (
        db.query(TournamentMembershipTrackStatus)
        .filter(TournamentMembershipTrackStatus.track_id == track_id)
        .count()
    )


def live_primary_track_count(db: Session, tournament_id: int, *, excluding_id: int | None = None) -> int:
    query = db.query(TournamentTrack).filter(
        TournamentTrack.tournament_id == tournament_id,
        TournamentTrack.is_primary.is_(True),
        TournamentTrack.is_archived.is_(False),
    )
    if excluding_id is not None:
        query = query.filter(TournamentTrack.id != excluding_id)
    return query.count()


def purge_pending_tracks(db: Session, tournament_id: int, actor_id: int) -> list[int]:
    """Hard-delete every pending track nothing TD-authored points at any more.

    Called after any write that could have cleared the last reference — a
    shift moving to another track, a form field being re-bound or archived.
    Does not commit; the caller's own commit carries it, so a failed edit
    can't purge a track as a side effect. Returns the purged track ids."""
    pending = (
        db.query(TournamentTrack)
        .filter(
            TournamentTrack.tournament_id == tournament_id,
            TournamentTrack.is_archived.is_(True),
        )
        .all()
    )

    purged: list[int] = []
    for track in pending:
        if track_blocking_references(db, tournament_id, track.id):
            continue
        log_action(
            db, tournament_id, actor_id, TRACK_PURGED,
            target_type="track", target_id=track.id,
            extra_data={
                "name": track.name,
                "member_rows_deleted": track_member_data_count(db, track.id),
            },
        )
        db.delete(track)
        purged.append(track.id)

    return purged
