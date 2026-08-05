from __future__ import annotations
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.join_codes import apply_join_code_update, deactivate_join_code, get_unique_join_code
from app.core.tournament.audit import JOIN_CODE_CREATED, JOIN_CODE_DEACTIVATED, JOIN_CODE_UPDATED, log_action
from app.core.tournament.permissions import MANAGE_TOURNAMENT, require_permission
from app.db.session import get_db
from app.models.models import JoinCode, Tournament, User
from app.schemas.join_code import JoinCodeCreate, JoinCodeResponse, JoinCodeUpdate

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


def _get_join_code_or_404(code_id: int, tournament_id: int, db: Session) -> JoinCode:
    jc = db.query(JoinCode).filter(JoinCode.id == code_id).first()
    if not jc or jc.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Join code not found")
    return jc


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/join-codes/ — manage_tournament
# ---------------------------------------------------------------------------
@router.get("/{tournament_id}/join-codes/", response_model=list[JoinCodeResponse])
def list_join_codes(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    return (
        db.query(JoinCode)
        .filter(JoinCode.tournament_id == tournament_id)
        .order_by(JoinCode.created_at.desc())
        .all()
    )


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/join-codes/ — manage_tournament
# ---------------------------------------------------------------------------
@router.post(
    "/{tournament_id}/join-codes/",
    response_model=JoinCodeResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_join_code(
    tournament_id: int,
    payload: JoinCodeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    expires_at = None
    if payload.expires_in_hours is not None:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=payload.expires_in_hours)

    join_code = JoinCode(
        tournament_id=tournament_id,
        created_by=current_user.id,
        code=get_unique_join_code(db),
        label=payload.label,
        expires_at=expires_at,
        is_active=True,
    )
    db.add(join_code)
    db.flush()  # get join_code.id before logging

    log_action(
        db, tournament_id, current_user.id, JOIN_CODE_CREATED,
        target_type="join_code", target_id=join_code.id,
        extra_data={
            "code": join_code.code,
            "label": join_code.label,
            "expires_in_hours": payload.expires_in_hours,
            "expires_at": expires_at.isoformat() if expires_at else None,
        },
    )

    db.commit()
    db.refresh(join_code)
    return join_code


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/join-codes/{code_id}/ — manage_tournament
# Label and/or extend expiry — see deactivate_join_code() for deactivation.
# ---------------------------------------------------------------------------
@router.patch("/{tournament_id}/join-codes/{code_id}/", response_model=JoinCodeResponse)
def update_join_code(
    tournament_id: int,
    code_id: int,
    payload: JoinCodeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    join_code = _get_join_code_or_404(code_id, tournament_id, db)
    old_label = join_code.label
    old_expires_at = join_code.expires_at

    apply_join_code_update(join_code, payload.label, payload.add_hours)

    extra_data = {}
    if payload.label is not None and payload.label != old_label:
        extra_data["changes"] = {"label": {"old": old_label, "new": payload.label}}
    if payload.add_hours is not None:
        extra_data["add_hours"] = payload.add_hours
        extra_data["expires_at"] = {
            "old": old_expires_at.isoformat() if old_expires_at else None,
            "new": join_code.expires_at.isoformat() if join_code.expires_at else None,
        }

    if extra_data:
        log_action(
            db, tournament_id, current_user.id, JOIN_CODE_UPDATED,
            target_type="join_code", target_id=join_code.id,
            extra_data=extra_data,
        )

    db.commit()
    db.refresh(join_code)
    return join_code


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/join-codes/{code_id}/ — manage_tournament
# Deactivates the join code (one-way) — does not remove the row, so
# use_count/history stay visible via GET.
# ---------------------------------------------------------------------------
@router.delete("/{tournament_id}/join-codes/{code_id}/", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_tournament_join_code(
    tournament_id: int,
    code_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    join_code = _get_join_code_or_404(code_id, tournament_id, db)
    deactivate_join_code(join_code)

    log_action(
        db, tournament_id, current_user.id, JOIN_CODE_DEACTIVATED,
        target_type="join_code", target_id=join_code.id,
        extra_data={"code": join_code.code},
    )

    db.commit()
