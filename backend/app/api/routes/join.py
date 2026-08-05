from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.join_codes import is_join_code_expired
from app.db.session import get_db
from app.models.models import ChapterMembership, JoinCode, TournamentMembership, User
from app.schemas.join_code import JoinRedeemResponse

router = APIRouter(tags=["join"])


# ---------------------------------------------------------------------------
# POST /join/?code={code} — any authenticated user
#
# Single entry point for both tournament and chapter invite codes. `code` is
# globally unique across JoinCode (tournament_id/chapter_id are mutually
# exclusive), so one lookup is enough to know which onboarding flow to run —
# the frontend no longer needs to guess which endpoint to hit.
#
# Deliberately generic errors on the initial lookup — 400 without
# distinguishing invalid vs. expired vs. deactivated, so a caller can't use
# error specificity to probe which codes exist.
# ---------------------------------------------------------------------------
@router.post("/join/", response_model=JoinRedeemResponse, status_code=status.HTTP_201_CREATED)
def redeem_join_code(
    code: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Redeem a tournament or chapter invite code. Authenticated.

    Looks the code up once against the shared JoinCode table, then dispatches
    to the matching redemption flow based on which target it points to.
    400 if the code is invalid, deactivated, or expired.
    """
    join_code = db.query(JoinCode).filter(JoinCode.code == code).first()
    if not join_code or not join_code.is_active or is_join_code_expired(join_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired join code")

    if join_code.tournament_id is not None:
        return _redeem_tournament_code(join_code, current_user, db)
    return _redeem_chapter_code(join_code, current_user, db)


def _redeem_tournament_code(join_code: JoinCode, current_user: User, db: Session) -> JoinRedeemResponse:
    """Creates a bare TournamentMembership with no roles, status='interested' —
    staff assign roles afterward."""
    existing = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == current_user.id,
            TournamentMembership.tournament_id == join_code.tournament_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already a member of this tournament")

    membership = TournamentMembership(
        user_id=current_user.id,
        tournament_id=join_code.tournament_id,
        status="interested",
        source="join_code",
        join_code_id=join_code.id,
    )
    join_code.use_count += 1

    try:
        db.add(membership)
        db.commit()
        db.refresh(membership)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already a member of this tournament")

    return JoinRedeemResponse(type="tournament", target_id=membership.tournament_id, membership_id=membership.id)


def _redeem_chapter_code(join_code: JoinCode, current_user: User, db: Session) -> JoinRedeemResponse:
    """One chapter per user — unlike tournaments, membership is role='member' immediately."""
    existing_membership = (
        db.query(ChapterMembership)
        .filter(ChapterMembership.user_id == current_user.id)
        .first()
    )
    if existing_membership:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already a member of a chapter")

    membership = ChapterMembership(
        user_id=current_user.id,
        chapter_id=join_code.chapter_id,
        role="member",
    )
    join_code.use_count += 1

    try:
        db.add(membership)
        db.commit()
        db.refresh(membership)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already a member of a chapter")

    return JoinRedeemResponse(type="chapter", target_id=membership.chapter_id, membership_id=membership.id)
