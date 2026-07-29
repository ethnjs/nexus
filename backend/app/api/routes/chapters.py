from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.models.models import User, AlumniChapter, ChapterMembership
from app.db.session import get_db
from app.schemas.chapter import ChapterCreate, ChapterResponse, ChapterUpdate, AssignLeadRequest, ChapterMemberResponse
from app.core.chapters import _create_chapter, check_if_chapter_exists, require_chapter_lead_or_admin, require_lead, _assign_chapter_lead

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


@router.post("/{chapter_id}/leads/", response_model= ChapterMemberResponse, status_code=status.HTTP_201_CREATED)
def assign_lead(
    chapter_id: int,
    body: AssignLeadRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin)
):
    """Assign a user "lead" role in a chapter. Admin only"""
    return _assign_chapter_lead(chapter_id, body.user_id, db)


@router.delete("/{chapter_id}/leads/{user_id}/", status_code=status.HTTP_204_NO_CONTENT)
def remove_lead(
    chapter_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin)
):
    """Remove "lead" role from a user in chapter. Admin only"""
    user = db.query(ChapterMembership).filter(ChapterMembership.user_id == user_id).first()
    if not user or user.chapter_id != chapter_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User is not in this chapter"
        )
    if user.role != "lead":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User is not a lead in this chapter"
        )
    user.role = "member"
    db.commit()
    db.refresh(user)



@router.get("/{chapter_id}/members/", response_model=list[ChapterMemberResponse])
def get_members(
    chapter_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_chapter_lead_or_admin)
):
    """Get a list of all members in a chapter. Admin and Chapter Lead only"""
    return db.query(ChapterMembership).join(User, ChapterMembership.user_id == User.id).filter(ChapterMembership.chapter_id == chapter_id).order_by(User.first_name.asc(), User.last_name.asc()).all()


@router.delete("/{chapter_id}/members/{user_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_member(
    chapter_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_chapter_lead_or_admin)
):
    """Delete existing user from chapter. Admin and Chapter Lead only"""
    member = db.query(ChapterMembership).filter(ChapterMembership.chapter_id == chapter_id, ChapterMembership.user_id == user_id).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    db.delete(member)
    db.commit()


@router.patch("/{chapter_id}/members/{user_id}/", response_model=ChapterMemberResponse)
def update_chapter_roles(
    chapter_id: int,
    user_id: int,
    role: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_lead)
):
    """Update roles of members in a chapter. Lead only"""
    member = db.query(ChapterMembership).filter(ChapterMembership.chapter_id == chapter_id, ChapterMembership.user_id == user_id).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    if member.role == role:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already has that role")
    member.role = role
    db.commit()
    db.refresh()
    return member
# TODO(temp): officers get management powers later


@router.get("/{chapter_id}/members/{user_id}/profile/", response_model=ChapterMemberResponse)
def get_chapter_member(
    chapter_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    lead: User = Depends(require_lead)
):
    """View chapter member profile. Lead only"""
    if lead.chapter_membership.chapter_id != chapter_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a lead for this chapter")
    member = db.query(ChapterMembership).filter(ChapterMembership.chapter_id == chapter_id, ChapterMembership.user_id == user_id).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return member
