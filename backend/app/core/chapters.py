from fastapi import HTTPException, status, Depends
from typing import Optional
from sqlalchemy.orm import Session

from app.models.models import User, AlumniChapter, ChapterMembership
from app.core.auth import get_current_user
from app.db.session import get_db

def _create_chapter(
        db: Session,
        name: str,
        university_id: int
    ) -> AlumniChapter:

    chapter = AlumniChapter(
        name=name,
        university_id=university_id
    )
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    return chapter

def check_if_chapter_exists(db: Session, university_id: int):
    existing = db.query(AlumniChapter).filter(AlumniChapter.university_id == university_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Alumni Chapter already exists"
        )

def require_lead(
        db: Session = Depends(get_db),
        chapter_id = int,
        current_user: User = Depends(get_current_user),
    ) -> User:
    lead = db.query(ChapterMembership).filter(
        ChapterMembership.chapter_id == chapter_id,
        ChapterMembership.user_id == current_user.id,
        ChapterMembership.role == "lead"
    ).first()

    if not lead:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )
    return current_user

def require_chapter_lead_or_admin(
        chapter_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
    ) -> User:
    if current_user.role == "admin":
        return current_user
    
    lead = db.query(ChapterMembership).filter(
        ChapterMembership.chapter_id == chapter_id,
        ChapterMembership.user_id == current_user.id,
        ChapterMembership.role == "lead"
    ).first()

    if not lead:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )
    return current_user

def _assign_chapter_lead(
        db: Session,
        chapter_id: int,
        user_id: int,
    ) -> ChapterMembership:
    assignee = db.query(ChapterMembership).filter(ChapterMembership.user_id == user_id).first()
    if not assignee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User is not a chapter member"
        )
