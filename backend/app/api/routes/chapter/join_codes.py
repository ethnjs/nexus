from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.chapters import find_chapter, require_lead
from app.core.join_codes import apply_join_code_update, deactivate_join_code, get_unique_join_code
from app.db.session import get_db
from app.models.models import AlumniChapter, JoinCode, User
from app.schemas.join_code import JoinCodeCreate, JoinCodeResponse, JoinCodeUpdate

router = APIRouter(tags=["chapters"])


def _get_join_code_or_404(code_id: int, chapter_id: int, db: Session) -> JoinCode:
    jc = db.query(JoinCode).filter(JoinCode.id == code_id).first()
    if not jc or jc.chapter_id != chapter_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Join code not found")
    return jc


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
    return db.query(JoinCode).with_parent(chapter, AlumniChapter.join_codes).all()


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

    join_code = JoinCode(
        chapter_id=chapter.id,
        created_by=user.id,
        code=get_unique_join_code(db),
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
