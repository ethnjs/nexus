from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.chapters import find_chapter, require_chapter_lead_or_admin, require_lead, require_officer_or_lead
from app.db.session import get_db
from app.models.models import AlumniChapter, ChapterMembership, User
from app.schemas.chapter.membership import ChapterMemberProfileResponse, ChapterMemberResponse, ChapterMemberUpdate

router = APIRouter(prefix="/chapters/{chapter_id}/members", tags=["chapters"])


# ---------------------------------------------------------------------------
# GET /chapters/{chapter_id}/members/ — list all members of a chapter, sorted by name. Chapter officer, lead, or admin.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[ChapterMemberResponse])
def get_members(
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_officer_or_lead),
):
    """List all members of a chapter, sorted by name. Chapter officer, lead, or admin."""
    return (
        db.query(ChapterMembership)
        .join(User, ChapterMembership.user_id == User.id)
        .filter(ChapterMembership.chapter_id == chapter.id)
        .order_by(User.first_name.asc(), User.last_name.asc())
        .all()
    )


# ---------------------------------------------------------------------------
# GET /chapters/{chapter_id}/members/{user_id}/profile/ — view a member's full profile. Chapter lead only.
# ---------------------------------------------------------------------------
@router.get("/{user_id}/profile/", response_model=ChapterMemberProfileResponse)
def get_chapter_member(
    user_id: int,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_lead),
):
    """View a member's full profile — major, university, competition/volunteer experience. Chapter lead only."""
    member = db.query(ChapterMembership).with_parent(chapter, AlumniChapter.chapter_memberships).filter(ChapterMembership.user_id == user_id).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return member


# ---------------------------------------------------------------------------
# PATCH /chapters/{chapter_id}/members/{user_id}/ — change a member's role within their own chapter. Chapter lead only.
# ---------------------------------------------------------------------------
@router.patch("/{user_id}/", response_model=ChapterMemberResponse)
def update_chapter_member(
    user_id: int,
    payload: ChapterMemberUpdate,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_lead),
):
    """Change a member's role within their own chapter. Chapter lead only.

    Covers promote/demote to officer as well as a lead assigning another
    lead for their own chapter. 409 if the member already has that role.

    # TODO(temp): officers get management powers later
    """
    member = db.query(ChapterMembership).with_parent(chapter, AlumniChapter.chapter_memberships).filter(ChapterMembership.user_id == user_id).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    if member.role == payload.role:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already has that role")
    member.role = payload.role
    db.commit()
    db.refresh(member)
    return member


# ---------------------------------------------------------------------------
# DELETE /chapters/{chapter_id}/members/{user_id}/ — remove a member from a chapter. Chapter lead or admin only.
# ---------------------------------------------------------------------------
@router.delete("/{user_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_member(
    user_id: int,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_chapter_lead_or_admin),
):
    """Remove a member from a chapter. Chapter lead or admin only."""
    member = db.query(ChapterMembership).with_parent(chapter, AlumniChapter.chapter_memberships).filter(ChapterMembership.user_id == user_id).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    db.delete(member)
    db.commit()
