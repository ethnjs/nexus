from fastapi import HTTPException, status, Depends
from typing import Optional
from sqlalchemy.orm import Session

from app.models.models import User, AlumniChapter, ChapterMembership
from app.core.auth import get_current_user
from app.db.session import get_db

def create_alumni_chapter(
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

def _require_chapter_role(
        chapter_id: int,
        allowed_roles: set[str],
        db: Session,
        current_user: User,
        allow_admin: bool = False,
    ) -> User:
    if allow_admin and current_user.role == "admin":
        return current_user

    membership = db.query(ChapterMembership).filter(
        ChapterMembership.chapter_id == chapter_id,
        ChapterMembership.user_id == current_user.id,
        ChapterMembership.role.in_(allowed_roles),
    ).first()

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )
    return current_user

def require_lead(
        chapter_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
    return _require_chapter_role(chapter_id, {"lead"}, db, current_user)

def require_officer_or_lead(
        chapter_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
    """Officers and leads both pass — leads can do everything officers can."""
    return _require_chapter_role(chapter_id, {"lead", "officer"}, db, current_user, allow_admin=True)

def require_chapter_lead_or_admin(
        chapter_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
    ) -> User:
    return _require_chapter_role(chapter_id, {"lead"}, db, current_user, allow_admin=True)

def assign_chapter_lead(
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
