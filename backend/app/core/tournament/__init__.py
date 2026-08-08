from __future__ import annotations
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import Tournament


def get_tournament(tournament_id: int, db: Session = Depends(get_db)) -> Tournament:
    """Fetch the tournament identified by the tournament_id path param, or 404."""
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return tournament


def require_not_archived(tournament: Tournament) -> None:
    """
    Call explicitly in every POST/PATCH/DELETE route, right after fetching
    the tournament via get_tournament() — archived tournaments stay fully
    readable, so this isn't baked into get_tournament itself or into
    require_permission()/require_membership(), both of which also gate GETs.
    """
    if tournament.is_archived:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This tournament is archived and cannot be modified.",
        )