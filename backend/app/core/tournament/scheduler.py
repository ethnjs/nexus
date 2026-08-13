"""
Daily auto-archive job — tournaments past their end_date are archived
automatically, same as a manual archive/ but attributed to the owner and
flagged as automatic in extra_data. Skips tournaments already archived and
ones with an archive_override_at set (a human already unarchived a past-due
tournament — see Tournament.archive_override_at for the full rationale).
"""
from __future__ import annotations
from datetime import date

from sqlalchemy.orm import Session

from app.core.join_codes import deactivate_tournament_join_codes
from app.core.tournament.audit import TOURNAMENT_ARCHIVED, log_action
from app.models.models import Tournament


def archive_ended_tournaments(db: Session) -> int:
    """Archive every non-archived, non-overridden tournament past its
    end_date. Commits. Returns the number archived."""
    tournaments = (
        db.query(Tournament)
        .filter(
            Tournament.end_date < date.today(),
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
