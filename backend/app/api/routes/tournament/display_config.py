from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.tournament import get_tournament, require_not_archived
from app.core.tournament.display_config import KNOWN_SURFACES, is_known_namespace
from app.core.tournament.permissions import MANAGE_MEMBERS, require_permission
from app.db.session import get_db
from app.models.models import User
from app.schemas.tournament.display_config import DisplayConfigSurface

router = APIRouter(prefix="/tournaments/{tournament_id}/display-config", tags=["tournaments"])


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/display-config/ — manage_members
# Lenient on read: an unknown surface key or a dangling namespaced item
# (e.g. a deleted track's "track:3") is returned as-is, never an error — a
# stale reference must not 500 the members page that reads this.
# ---------------------------------------------------------------------------
@router.get("/", response_model=dict[str, DisplayConfigSurface])
def get_display_config(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    tournament = get_tournament(tournament_id, db)
    return tournament.display_config or {}


# ---------------------------------------------------------------------------
# PUT /tournaments/{tournament_id}/display-config/ — manage_members
# Strict on write: an unknown surface key or namespace is rejected outright,
# the opposite of the read side — bad data should never get in, even though
# a save is required to handle whatever's already in there.
# ---------------------------------------------------------------------------
@router.put("/", response_model=dict[str, DisplayConfigSurface])
def update_display_config(
    tournament_id: int,
    payload: dict[str, DisplayConfigSurface],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    for surface, config in payload.items():
        if surface not in KNOWN_SURFACES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unknown surface '{surface}'",
            )
        for item in config.hidden:
            if not is_known_namespace(item):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Unknown namespace for hidden item '{item}'",
                )

    tournament.display_config = {surface: config.model_dump() for surface, config in payload.items()}
    db.commit()
    db.refresh(tournament)
    return tournament.display_config
