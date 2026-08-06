from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.tournament.permissions import MANAGE_TOURNAMENT, require_permission
from app.core.tournament.setup_checklist import get_checklist
from app.db.session import get_db
from app.models.models import Tournament, User
from app.schemas.tournament.setup_checklist import SetupChecklistResponse

# Routes are nested: /tournaments/{tournament_id}/setup-checklist/
router = APIRouter(prefix="/tournaments/{tournament_id}/setup-checklist", tags=["tournaments"])


def _get_tournament_or_404(tournament_id: int, db: Session) -> Tournament:
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return tournament


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/setup-checklist/ — manage_tournament
# Owner-or-manage_tournament in practice: require_permission already grants
# the owner every permission via the owner_id short-circuit, so there's no
# separate "or owner" branch needed here.
# ---------------------------------------------------------------------------
@router.get("/", response_model=SetupChecklistResponse)
def get_setup_checklist(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    tournament = _get_tournament_or_404(tournament_id, db)
    return get_checklist(db, tournament)
