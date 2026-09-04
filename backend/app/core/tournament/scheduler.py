"""
Daily auto-archive job — tournaments past their end_date are archived
automatically, same as a manual archive/ but attributed to the owner and
flagged as automatic in extra_data. Skips tournaments already archived and
ones with an archive_override_at set (a human already unarchived a past-due
tournament — see Tournament.archive_override_at for the full rationale).
"""
from __future__ import annotations
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.join_codes import deactivate_tournament_join_codes
from app.core.tournament.audit import TOURNAMENT_ARCHIVED, log_action
from app.models.models import Tournament, TournamentTrack


def archive_ended_tournaments(db: Session) -> int:
    """Archive every non-archived, non-overridden tournament past its
    end_date. Commits. Returns the number archived."""
    # end_date is a Python property over the tournament's primary tracks, so
    # it can't be filtered on directly. The equivalent in SQL is the same
    # aggregate: a tournament has ended when the latest of its live primary
    # tracks has. A tournament with no dated primary track matches nothing and
    # is correctly left alone.
    ended = (
        db.query(TournamentTrack.tournament_id)
        .filter(
            TournamentTrack.is_primary.is_(True),
            TournamentTrack.is_archived.is_(False),
            TournamentTrack.end_date.isnot(None),
        )
        .group_by(TournamentTrack.tournament_id)
        .having(func.max(TournamentTrack.end_date) < date.today())
        .subquery()
    )

    tournaments = (
        db.query(Tournament)
        .filter(
            Tournament.id.in_(db.query(ended.c.tournament_id)),
            Tournament.is_archived.is_(False),
            Tournament.archive_override_at.is_(None),
        )
        .all()
    )

    for tournament in tournaments:
        tournament.is_archived = True
        deactivate_tournament_join_codes(db, tournament.id)
        log_action(
            db, tournament.id, tournament.owner_id, TOURNAMENT_ARCHIVED,
            target_type="tournament", target_id=tournament.id,
            extra_data={"auto_archived": True},
        )

    db.commit()
    return len(tournaments)
