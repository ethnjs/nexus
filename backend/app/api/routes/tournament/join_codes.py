from __future__ import annotations
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.join_codes import apply_join_code_update, deactivate_join_code, get_unique_join_code, is_join_code_expired
from app.core.permissions import MANAGE_TOURNAMENT, require_permission
from app.db.session import get_db
from app.models.models import Tournament, TournamentJoinCode, TournamentMembership, User
from app.schemas.join_code import JoinCodeCreate, JoinCodeResponse, JoinCodeUpdate

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


def _get_join_code_or_404(code_id: int, tournament_id: int, db: Session) -> TournamentJoinCode:
    jc = db.query(TournamentJoinCode).filter(TournamentJoinCode.id == code_id).first()
    if not jc or jc.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Join code not found")
    return jc


# ---------------------------------------------------------------------------
# POST /tournaments/join/?code={code} — any authenticated user
#
# Declared before the /{tournament_id}/... routes for path-matching clarity,
# though it doesn't actually collide: tournament_id is int-typed, so
# Starlette's int converter never matches the literal segment "join".
#
# Deliberately generic errors — 400 without distinguishing invalid vs.
# expired vs. deactivated, so a caller can't use error specificity to probe
# which codes exist.
# ---------------------------------------------------------------------------
@router.post("/join/", status_code=status.HTTP_201_CREATED)
def join_tournament_by_code(
    code: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    join_code = db.query(TournamentJoinCode).filter(TournamentJoinCode.code == code).first()
    if not join_code or not join_code.is_active or is_join_code_expired(join_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired join code")

    existing = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == current_user.id,
            TournamentMembership.tournament_id == join_code.tournament_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Already a member of this tournament",
        )

    membership = TournamentMembership(
        user_id=current_user.id,
        tournament_id=join_code.tournament_id,
        status="interested",
    )
    join_code.use_count += 1

    try:
        db.add(membership)
        db.commit()
        db.refresh(membership)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Already a member of this tournament",
        )

    return {"tournament_id": membership.tournament_id, "membership_id": membership.id}


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
        db.query(TournamentJoinCode)
        .filter(TournamentJoinCode.tournament_id == tournament_id)
        .order_by(TournamentJoinCode.created_at.desc())
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

    join_code = TournamentJoinCode(
        tournament_id=tournament_id,
        created_by=current_user.id,
        code=get_unique_join_code(db, TournamentJoinCode),
        label=payload.label,
        expires_at=expires_at,
        is_active=True,
    )
    db.add(join_code)
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
    apply_join_code_update(join_code, payload.label, payload.add_hours)

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
    db.commit()
