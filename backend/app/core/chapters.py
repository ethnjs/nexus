from fastapi import HTTPException, status, Depends
from typing import Optional
from sqlalchemy.orm import Session

from app.models.models import User, AlumniChapter, ChapterMembership
from app.core.auth import get_current_user
from app.db.session import get_db

import string
import secrets

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

def find_chapter(
        chapter_id: int,
        db: Session = Depends(get_db)
        ):
    chapter = db.query(AlumniChapter).filter(AlumniChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alumni Chapter not found"
        )
    return chapter

def require_lead(
        chapter_id: int,
        db: Session = Depends(get_db),
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
        chapter_id: int,
        user_id: int,
        db: Session
    ) -> ChapterMembership:
    chapter_member = db.query(ChapterMembership).filter(ChapterMembership.user_id == user_id).first()
    if chapter_member:
        if chapter_member.chapter_id != chapter_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User is in a different chapter"
            )
        if chapter_member.role == "lead":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User is already a lead"
            )
        chapter_member.role = "lead"
    else:
        chapter_member = ChapterMembership(
            chapter_id=chapter_id,
            user_id=user_id,
            role="lead"
        )
        db.add(chapter_member)
    db.commit()
    db.refresh(chapter_member)
    return chapter_member

AMBIGUOUS_CHARS = set("0O1Il")
ALLOWED_CHARS = "".join([c for c in string.ascii_letters + string.digits if c not in AMBIGUOUS_CHARS])

def generate_chapter_join_code(length: int = 8) -> str:
    """Generates an 8-character cryptographically secure random alphanumeric code."""
    return "".join(secrets.choice(ALLOWED_CHARS) for _ in range(length))
    