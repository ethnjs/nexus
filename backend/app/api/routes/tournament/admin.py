from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.db.session import get_db
from app.models.models import Tournament, User

router = APIRouter(prefix="/admin/tournaments", tags=["tournaments"])


class VerifyRequest(BaseModel):
    is_verified: bool


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
