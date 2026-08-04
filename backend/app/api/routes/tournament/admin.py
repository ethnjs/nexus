from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.db.session import get_db
from app.models.models import Tournament, User
from app.schemas.tournament import TournamentRead
from app.api.routes.tournament import _serialize

router = APIRouter(prefix="/admin/tournaments", tags=["tournaments"])


class VerifyRequest(BaseModel):
    is_verified: bool


# ---------------------------------------------------------------------------
# GET /admin/tournaments/ — platform admin only (global list)
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[TournamentRead])
def list_all_tournaments(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """List every tournament, regardless of membership. Admin only."""
    tournaments = db.query(Tournament).order_by(Tournament.created_at.desc()).all()
    return [_serialize(t) for t in tournaments]


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
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    tournament.is_verified = payload.is_verified
    db.commit()
    return {"id": tournament.id, "is_verified": tournament.is_verified}
