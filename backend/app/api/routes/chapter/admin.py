from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.core.chapters import assign_chapter_lead, create_alumni_chapter, check_if_chapter_exists, find_chapter
from app.db.session import get_db
from app.models.models import AlumniChapter, ChapterMembership, User
from app.schemas.chapter import ChapterCreate, ChapterResponse
from app.schemas.chapter.membership import AssignLeadRequest, ChapterMemberResponse

router = APIRouter(prefix="/admin/chapters", tags=["chapters"])


# ---------------------------------------------------------------------------
# GET /admin/chapters/ — list every alumni chapter. Admin only.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[ChapterResponse])
def get_chapter_list(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """List every alumni chapter. Admin only."""
    return db.query(AlumniChapter).order_by(AlumniChapter.name).all()


# ---------------------------------------------------------------------------
# POST /admin/chapters/ — create a new chapter for a university. Admin only.
# ---------------------------------------------------------------------------
@router.post("/", response_model=ChapterResponse, status_code=status.HTTP_201_CREATED)
def create_chapter(
    body: ChapterCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Create a new chapter for a university. Admin only.

    409 if that university already has a chapter — one chapter per university.
    """
    check_if_chapter_exists(db, body.university_id)
    return create_alumni_chapter(db, body.name, body.university_id)


# ---------------------------------------------------------------------------
# POST /admin/chapters/{chapter_id}/leads/ — assign a user as this chapter's lead. Admin only.
# ---------------------------------------------------------------------------
@router.post("/{chapter_id}/leads/", response_model=ChapterMemberResponse, status_code=status.HTTP_201_CREATED)
def assign_lead(
    body: AssignLeadRequest,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Assign a user as this chapter's lead. Admin only.

    Promotes an existing membership to lead, or creates one. 409 if the user
    already leads/belongs to a different chapter, or is already this
    chapter's lead.
    """
    return assign_chapter_lead(chapter.id, body.user_id, db)


# ---------------------------------------------------------------------------
# DELETE /admin/chapters/{chapter_id}/leads/{user_id}/ — demote a chapter's lead to a regular member. Admin only.
# ---------------------------------------------------------------------------
@router.delete("/{chapter_id}/leads/{user_id}/", status_code=status.HTTP_204_NO_CONTENT)
def remove_lead(
    user_id: int,
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Demote a chapter's lead back to a regular member. Admin only."""
    member = db.query(ChapterMembership).with_parent(chapter, AlumniChapter.chapter_memberships).filter(ChapterMembership.user_id == user_id).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not in this chapter")
    if member.role != "lead":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not a lead in this chapter")
    member.role = "member"
    db.commit()
    db.refresh(member)
