from __future__ import annotations
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.auth import require_admin
from app.core.tournament.audit import TOURNAMENT_VERIFIED, log_action
from app.core.tournament import get_tournament, require_not_archived, tournament_counts
from app.db.session import get_db
from app.models.models import Tournament, User
from app.schemas.tournament import AdminTournamentRead
from app.api.routes.tournament import _serialize

router = APIRouter(prefix="/admin/tournaments", tags=["tournaments"])


class VerifyRequest(BaseModel):
    is_verified: bool


# ---------------------------------------------------------------------------
# GET /admin/tournaments/ — platform admin only (global list)
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[AdminTournamentRead])
def list_all_tournaments(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """List every tournament, regardless of membership. Admin only.

    Carries the owner and the event/volunteer counts so the admin table can
    judge a tournament without opening it. Owner and tracks are eager-loaded
    and the counts come from two grouped queries, so the response costs a
    fixed number of queries no matter how many tournaments exist.
    """
    tournaments = (
        db.query(Tournament)
        .options(joinedload(Tournament.owner), selectinload(Tournament.tracks))
        .order_by(Tournament.created_at.desc())
        .all()
    )
    counts = tournament_counts(db, [t.id for t in tournaments])
    return [
        AdminTournamentRead(**_serialize(t), owner=t.owner, **counts[t.id])
        for t in tournaments
    ]


# ---------------------------------------------------------------------------
# PATCH /admin/tournaments/{tournament_id}/verify/ — platform admin only
# The only route that can flip Tournament.is_verified — never settable by
# the tournament's own TD.
# ---------------------------------------------------------------------------
@router.patch("/{tournament_id}/verify/")
def set_tournament_verified(
    tournament_id: int,
    payload: VerifyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    tournament.is_verified = payload.is_verified

    log_action(
        db, tournament.id, current_user.id, TOURNAMENT_VERIFIED,
        target_type="tournament", target_id=tournament.id,
        extra_data={"is_verified": payload.is_verified},
    )

    db.commit()
    return {"id": tournament.id, "is_verified": tournament.is_verified}
