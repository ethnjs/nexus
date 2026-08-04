from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.chapters import find_chapter, require_lead
from app.core.join_codes import apply_join_code_update, deactivate_join_code, get_unique_join_code, is_join_code_expired
from app.db.session import get_db
from app.models.models import AlumniChapter, ChapterJoinCode, ChapterMembership, User
from app.schemas.chapter.membership import ChapterMemberResponse
from app.schemas.join_code import JoinCodeCreate, JoinCodeResponse, JoinCodeUpdate

router = APIRouter(tags=["chapters"])


def _get_join_code_or_404(code_id: int, chapter_id: int, db: Session) -> ChapterJoinCode:
    jc = db.query(ChapterJoinCode).filter(ChapterJoinCode.id == code_id).first()
    if not jc or jc.chapter_id != chapter_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Join code not found")
    return jc


# ---------------------------------------------------------------------------
# POST /chapters/join/?code={code} — join a chapter using an invite code. Authenticated.
#
# Declared before GET /chapters/{chapter_id}/ on purpose — chapter_id is
# typed int, but Starlette matches path templates before type-validating
# params, so "/chapters/join/" would otherwise get swallowed by
# "/chapters/{chapter_id}/" and 422 instead of routing here.
# ---------------------------------------------------------------------------

@router.post("/chapters/join/", response_model=ChapterMemberResponse, status_code=status.HTTP_201_CREATED)
def join_chapter_by_code(
    code: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Join a chapter using an invite code. Authenticated.

    400 if the code is invalid, deactivated, or expired, or if the user is
    already in a chapter (one chapter per user). Deliberately generic —
    doesn't distinguish invalid vs. expired vs. deactivated, so a caller
    can't use error specificity to probe which codes exist.
    """
    existing_membership = (
        db.query(ChapterMembership)
        .filter(ChapterMembership.user_id == current_user.id)
        .first()
    )
    if existing_membership:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already a member of a chapter")

    join_code = db.query(ChapterJoinCode).filter(ChapterJoinCode.code == code).first()
    if not join_code or not join_code.is_active or is_join_code_expired(join_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired join code")

    new_membership = ChapterMembership(
        user_id=current_user.id,
        chapter_id=join_code.chapter_id,
        role="member",
    )
    join_code.use_count += 1

    try:
        db.add(new_membership)
        db.commit()
        db.refresh(new_membership)
        return new_membership
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already a member of a chapter")


# ---------------------------------------------------------------------------
# GET /chapters/{chapter_id}/join-codes/ — list every join code for a chapter. Chapter lead only.
# ---------------------------------------------------------------------------
@router.get("/chapters/{chapter_id}/join-codes/", response_model=list[JoinCodeResponse])
def get_chapter_join_codes(
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_lead),
):
    """List every join code for a chapter, including expired and deactivated ones. Chapter lead only."""
    return db.query(ChapterJoinCode).with_parent(chapter, AlumniChapter.chapter_join_codes).all()


# ---------------------------------------------------------------------------
# POST /chapters/{chapter_id}/join-codes/ — generate a new join code for a chapter. Chapter lead only.
# ---------------------------------------------------------------------------
@router.post("/chapters/{chapter_id}/join-codes/", response_model=JoinCodeResponse, status_code=status.HTTP_201_CREATED)
def generate_chapter_join_code(
    payload: JoinCodeCreate,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    user: User = Depends(require_lead),
):
    """Generate a new 8-character join code for a chapter. Chapter lead only.

    Optional label and expiry in hours from now — omit expires_in_hours for
    a code that never expires.
    """
    expires_at = None
    if payload.expires_in_hours is not None:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=payload.expires_in_hours)

    join_code = ChapterJoinCode(
        chapter_id=chapter.id,
        created_by=user.id,
        code=get_unique_join_code(db, ChapterJoinCode),
        label=payload.label,
        expires_at=expires_at,
        is_active=True,
    )
    db.add(join_code)
    db.commit()
    db.refresh(join_code)
    return join_code


# ---------------------------------------------------------------------------
# PATCH /chapters/{chapter_id}/join-codes/{code_id}/ — update a join code's label and/or extend its expiry. Chapter lead only.
# ---------------------------------------------------------------------------
@router.patch("/chapters/{chapter_id}/join-codes/{code_id}/", response_model=JoinCodeResponse)
def update_chapter_join_code(
    code_id: int,
    payload: JoinCodeUpdate,
    chapter: AlumniChapter = Depends(find_chapter),
    user: User = Depends(require_lead),
    db: Session = Depends(get_db),
):
    """Update a join code's label and/or extend its expiry. Chapter lead only.

    Deactivation is a separate DELETE, not part of this update.
    """
    join_code = _get_join_code_or_404(code_id, chapter.id, db)
    apply_join_code_update(join_code, payload.label, payload.add_hours)

    db.commit()
    db.refresh(join_code)
    return join_code


# ---------------------------------------------------------------------------
# DELETE /chapters/{chapter_id}/join-codes/{code_id}/ — deactivate a join code. Chapter lead only.
# Deactivates the join code (one-way) — does not remove the row, so
# use_count/history stay visible via GET.
# ---------------------------------------------------------------------------
@router.delete("/chapters/{chapter_id}/join-codes/{code_id}/", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_chapter_join_code(
    code_id: int,
    chapter: AlumniChapter = Depends(find_chapter),
    user: User = Depends(require_lead),
    db: Session = Depends(get_db),
):
    """Deactivate a join code. Chapter lead only. One-way — 400 if already deactivated."""
    join_code = _get_join_code_or_404(code_id, chapter.id, db)
    deactivate_join_code(join_code)
    db.commit()
