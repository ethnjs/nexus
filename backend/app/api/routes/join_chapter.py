from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from sqlalchemy.exc import IntegrityError

from app.core.auth import get_current_user
from app.models.models import ChapterJoinCode, User, ChapterMembership
from app.db.session import get_db
from app.schemas.chapter import ChapterPreviewResponse, ChapterJoinRequest, ChapterMemberResponse

router = APIRouter(prefix="", tags=["join_chapter"])


def _is_expired(join_code: ChapterJoinCode) -> bool:
    """Return whether a join code has passed its optional expiration time."""
    if join_code.expires_at is None:
        return False

    expires_at = join_code.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) > expires_at


@router.get("/join-chapter/", response_model=ChapterPreviewResponse, status_code=status.HTTP_200_OK)
def preview_chapter_by_join_code(
    code: str = Query(..., min_length=8, max_length=8, description="8-character join code"),
    db: Session = Depends(get_db)
):
    """Gets Preview info of a chapter when entering Join Code"""
    join_code = db.query(ChapterJoinCode).filter(ChapterJoinCode.code == code).first()
    if not join_code:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid join code"
        )
    
    if not join_code.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This join code has been deactivated"
        )

    if _is_expired(join_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This join code has expired"
        )

    return join_code.alumni_chapter


@router.post("/join-chapter/", status_code=status.HTTP_201_CREATED, response_model=ChapterMemberResponse)
def join_chapter_by_code(
    payload: ChapterJoinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Creates new entry of user in chapter after joining with code"""
    existing_membership = (
        db.query(ChapterMembership)
        .filter(ChapterMembership.user_id == current_user.id)
        .first()
    )
    if existing_membership:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already a member of a chapter"
        )
    
    join_code = (
        db.query(ChapterJoinCode)
        .filter(ChapterJoinCode.code == payload.code)
        .first()
    )
    if not join_code:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid join code"
        )

    if not join_code.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This join code has been deactivated"
        )

    if _is_expired(join_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This join code has expired"
        )

    new_membership = ChapterMembership(
        user_id=current_user.id,
        chapter_id=join_code.chapter_id,
        role="member"
    )

    try:
        db.add(new_membership)
        db.commit()
        db.refresh(new_membership)
        return new_membership
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already a member of a chapter"
        )
