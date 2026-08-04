from fastapi import APIRouter, Depends

from app.core.chapters import find_chapter, require_chapter_lead_or_admin
from app.db.session import get_db
from app.models.models import AlumniChapter, User
from app.schemas.chapter import ChapterResponse, ChapterUpdate
from sqlalchemy.orm import Session

router = APIRouter(tags=["chapters"])


# ---------------------------------------------------------------------------
# GET /chapters/{chapter_id}/ — get a chapter's name and university. Public.
# ---------------------------------------------------------------------------
@router.get("/chapters/{chapter_id}/", response_model=ChapterResponse)
def get_chapter(
    chapter: AlumniChapter = Depends(find_chapter),
):
    """Get a chapter's name and university. Public — no member data is exposed here."""
    return chapter


# ---------------------------------------------------------------------------
# PATCH /chapters/{chapter_id}/ — update a chapter's name/university. Chapter lead or admin.
# ---------------------------------------------------------------------------
@router.patch("/chapters/{chapter_id}/", response_model=ChapterResponse)
def update_chapter(
    payload: ChapterUpdate,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_chapter_lead_or_admin),
):
    """Update a chapter's name or university. Chapter lead or admin."""
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(chapter, field, value)
    db.commit()
    db.refresh(chapter)
    return chapter
