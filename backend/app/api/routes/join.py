from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.join_codes import is_join_code_expired
from app.db.session import get_db
from app.models.models import ChapterMembership, JoinCode, Tournament, TournamentMembership, User
from app.schemas.join_code import (
    JoinPreviewChapter, JoinPreviewResponse, JoinPreviewTournament, JoinRedeemRequest, JoinRedeemResponse,
)
from app.schemas.university import UniversityResponse

router = APIRouter(tags=["join"])


# ---------------------------------------------------------------------------
# GET /join/preview/?code={code} — public, no auth
#
# Read-only lookup so an invite link can show what's being joined before the
# visitor is even signed in. Same dispatch shape and generic error as the
# redeem route below (see that route's docstring) — kept as a sibling rather
# than folded together since one mutates and one doesn't.
# ---------------------------------------------------------------------------
@router.get("/join/preview/", response_model=JoinPreviewResponse)
def preview_join_code(
    code: str = Query(...),
    db: Session = Depends(get_db),
):
    """Preview a tournament or chapter invite code. No auth required.

    400 if the code is invalid, deactivated, or expired — same generic
    message as POST /join/, for the same reason (don't let error specificity
    probe which codes exist).
    """
    join_code = db.query(JoinCode).filter(JoinCode.code == code).first()
    if not join_code or not join_code.is_active or is_join_code_expired(join_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired join code")

    if join_code.tournament_id is not None:
        return _preview_tournament_code(join_code, db)
    return _preview_chapter_code(join_code, db)


def _preview_tournament_code(join_code: JoinCode, db: Session) -> JoinPreviewTournament:
    tournament = db.query(Tournament).filter(Tournament.id == join_code.tournament_id).first()
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired join code")

    return JoinPreviewTournament(
        target_id=tournament.id,
        name=tournament.name,
        short_name=tournament.short_name,
        start_date=tournament.start_date,
        end_date=tournament.end_date,
        university=UniversityResponse.model_validate(tournament.university) if tournament.university else None,
        location=tournament.location,
        state=tournament.state,
        level=tournament.level,
        division=tournament.division,
        is_verified=tournament.is_verified,
    )


def _preview_chapter_code(join_code: JoinCode, db: Session) -> JoinPreviewChapter:
    # Chapter invites aren't built yet — target_id is all there is to preview.
    return JoinPreviewChapter(target_id=join_code.chapter_id)


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
    body: JoinRedeemRequest = JoinRedeemRequest(),
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
        return _redeem_tournament_code(join_code, current_user, db, body.age_disclosure_consent)
    return _redeem_chapter_code(join_code, current_user, db)


def _redeem_tournament_code(
    join_code: JoinCode, current_user: User, db: Session, age_disclosure_consent: bool,
) -> JoinRedeemResponse:
    """Creates a bare TournamentMembership with no roles — staff assign roles
    afterward, and per-track participation comes from form write-through."""
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

    tournament = db.query(Tournament).filter(Tournament.id == join_code.tournament_id).first()
    collects_age_flag = tournament is not None and (tournament.collect_is_over_18 or tournament.collect_is_over_21)
    if collects_age_flag and not age_disclosure_consent:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "age_disclosure_required",
                "message": "This tournament requires age disclosure consent to join.",
            },
        )

    membership = TournamentMembership(
        user_id=current_user.id,
        tournament_id=join_code.tournament_id,
        source="join_code",
        join_code_id=join_code.id,
    )
    if collects_age_flag:
        membership.age_disclosure = "consented"
        membership.age_disclosure_at = datetime.now(timezone.utc)
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
