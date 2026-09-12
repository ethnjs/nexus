from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.join_codes import deactivate_tournament_join_codes
from app.core.tournament.audit import TOURNAMENT_ARCHIVED, log_action
from app.models.models import Form, Tournament


def archive_tournament(
    db: Session, tournament: Tournament, actor_id: int, extra_data: dict | None = None,
) -> None:
    """Every side effect of archiving, shared by the manual route and the
    auto-archive job so the two can't drift. Does not commit.

    Forms are archived too (drafts included) so nothing accepts responses.
    Unarchiving leaves them archived — the TD republishes deliberately."""
    tournament.is_archived = True
    tournament.archive_override_at = None
    deactivate_tournament_join_codes(db, tournament.id)
    db.query(Form).filter(
        Form.tournament_id == tournament.id,
        Form.status != "archived",
    ).update({"status": "archived"}, synchronize_session=False)

    log_action(
        db, tournament.id, actor_id, TOURNAMENT_ARCHIVED,
        target_type="tournament", target_id=tournament.id,
        extra_data=extra_data,
    )
