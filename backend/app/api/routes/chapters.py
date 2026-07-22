from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.models.models import User, University, AlumniChapter, ChapterMembership
from app.db.session import get_db
from app.schemas.chapter import ChapterCreate, ChapterResponse, ChapterUpdate
from app.core.chapters import _create_chapter, check_if_chapter_exists, require_chapter_lead_or_admin, require_lead

router = APIRouter(prefix="/chapters", tags=["chapters"])


@router.get("/", response_model=ChapterResponse)
def get_chapters(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin)
):
    """Get a list of all chapters. Admin only"""
    return db.query(AlumniChapter).order_by(AlumniChapter.name).all()


@router.post("/", response_model=ChapterResponse, status_code=status.HTTP_201_CREATED)
def create_chapter(
    body: ChapterCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin)
):
    """Create a new Chapter. Admin only."""
    check_if_chapter_exists(db, body.university_id)

    return _create_chapter(db, body.name, body.university_id)


@router.get("/{chapter_id}/", response_model=ChapterResponse)
def get_chapter(
    chapter_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_chapter_lead_or_admin)
):
    """Get a chapter info by id. Admin and Chapter Lead only"""
    return db.query(AlumniChapter).filter(AlumniChapter.id == chapter_id).first()


@router.patch("/{chapter_id}/", response_model=ChapterResponse)
def update_chapter(
    chapter_id: int,
    payload: ChapterUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin)
):
    """Update existing chapter from id. Admin only."""
    chapter = db.query(AlumniChapter).filter(AlumniChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(chapter, field, value)
    db.commit()
    db.refresh(chapter)
    return chapter
