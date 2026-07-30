from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.models.models import User, AlumniChapter, ChapterMembership
from app.db.session import get_db
from app.schemas.chapter import ChapterCreate, ChapterResponse, ChapterUpdate, AssignLeadRequest, ChapterMemberResponse
from app.core.chapters import _create_chapter, check_if_chapter_exists, require_chapter_lead_or_admin, require_lead, _assign_chapter_lead, find_chapter

router = APIRouter(prefix="/chapters", tags=["chapters"])


@router.get("/", response_model=list[ChapterResponse])
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
    chapter: AlumniChapter = Depends(find_chapter),
    _: User = Depends(require_chapter_lead_or_admin)
):
    """Get a chapter info by id. Admin and Chapter Lead only"""
    return chapter


@router.patch("/{chapter_id}/", response_model=ChapterResponse)
def update_chapter(
    payload: ChapterUpdate,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin)
):
    """Update existing chapter from id. Admin only."""
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(chapter, field, value)
    db.commit()
    db.refresh(chapter)
    return chapter


@router.post("/{chapter_id}/leads/", response_model= ChapterMemberResponse, status_code=status.HTTP_201_CREATED)
def assign_lead(
    body: AssignLeadRequest,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin)
):
    """Assign a user "lead" role in a chapter. Admin only"""
    return _assign_chapter_lead(chapter.id, body.user_id, db)


@router.delete("/{chapter_id}/leads/{user_id}/", status_code=status.HTTP_204_NO_CONTENT)
def remove_lead(
    user_id: int,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin)
):
    """Remove "lead" role from a user in chapter. Admin only"""
    user = db.query(ChapterMembership).with_parent(chapter, AlumniChapter.chapter_memberships).filter(ChapterMembership.user_id == user_id).first()
    if not user:
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
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_chapter_lead_or_admin)
):
    """Get a list of all members in a chapter. Admin and Chapter Lead only"""
    return db.query(ChapterMembership).join(User).with_parent(chapter, AlumniChapter.chapter_memberships).order_by(User.first_name.asc(), User.last_name.asc()).all()


@router.delete("/{chapter_id}/members/{user_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_member(
    user_id: int,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_chapter_lead_or_admin)
):
    """Delete existing user from chapter. Admin and Chapter Lead only"""
    member = db.query(ChapterMembership).with_parent(chapter, AlumniChapter.chapter_memberships).filter(ChapterMembership.user_id == user_id).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    db.delete(member)
    db.commit()


@router.patch("/{chapter_id}/members/{user_id}/", response_model=ChapterMemberResponse)
def update_chapter_roles(
    user_id: int,
    role: str,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_lead)
):
    """Update roles of members in a chapter. Lead only"""
    member = db.query(ChapterMembership).with_parent(chapter, AlumniChapter.chapter_memberships).filter(ChapterMembership.user_id == user_id).first()
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
    user_id: int,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    lead: User = Depends(require_lead)
):
    """View chapter member profile. Lead only"""
    if lead.chapter_membership.chapter_id != chapter.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a lead for this chapter")
    member = db.query(ChapterMembership).with_parent(chapter, AlumniChapter.chapter_memberships).filter(ChapterMembership.user_id == user_id).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return member