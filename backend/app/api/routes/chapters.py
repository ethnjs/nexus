from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_admin
from app.core.chapters import (
    assign_chapter_lead,
    create_alumni_chapter,
    check_if_chapter_exists,
    find_chapter,
    require_chapter_lead_or_admin,
    require_lead,
    require_officer_or_lead,
)
from app.core.join_codes import apply_join_code_patch, get_unique_join_code, is_join_code_expired
from app.db.session import get_db
from app.models.models import AlumniChapter, ChapterJoinCode, ChapterMembership, User
from app.schemas.chapter import (
    AssignLeadRequest,
    ChapterCreate,
    ChapterMemberProfileResponse,
    ChapterMemberResponse,
    ChapterMemberUpdate,
    ChapterResponse,
    ChapterUpdate,
)
from app.schemas.join_code import JoinCodeCreate, JoinCodeResponse, JoinCodeUpdate

router = APIRouter(tags=["chapters"])


# ---------------------------------------------------------------------------
# Admin: chapter CRUD + lead assignment
# ---------------------------------------------------------------------------

@router.get("/admin/chapters/", response_model=list[ChapterResponse])
def get_chapter_list(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """List every alumni chapter. Admin only."""
    return db.query(AlumniChapter).order_by(AlumniChapter.name).all()


@router.post("/admin/chapters/", response_model=ChapterResponse, status_code=status.HTTP_201_CREATED)
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


@router.post("/admin/chapters/{chapter_id}/leads/", response_model=ChapterMemberResponse, status_code=status.HTTP_201_CREATED)
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


@router.delete("/admin/chapters/{chapter_id}/leads/{user_id}/", status_code=status.HTTP_204_NO_CONTENT)
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


# ---------------------------------------------------------------------------
# POST /chapters/join/?code={code} -- Join flow (authenticated)
#
# Declared before GET /chapters/{chapter_id}/ on purpose — chapter_id is
# typed int, but Starlette matches path templates before type-validating
# params, so "/chapters/join/" would otherwise get swallowed by
# "/chapters/{chapter_id}/" and 422 instead of routing here.
# ---------------------------------------------------------------------------

@router.post("/chapters/join/", response_model=ChapterMemberResponse, status_code=status.HTTP_201_CREATED)
def join_chapter_by_code(
    code: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Join a chapter using an invite code. Authenticated.

    400 if the code is invalid, deactivated, or expired, or if the user is
    already in a chapter (one chapter per user). Deliberately generic —
    doesn't distinguish invalid vs. expired vs. deactivated, so a caller
    can't use error specificity to probe which codes exist.
    """
    existing_membership = (
        db.query(ChapterMembership)
        .filter(ChapterMembership.user_id == current_user.id)
        .first()
    )
    if existing_membership:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already a member of a chapter")

    join_code = db.query(ChapterJoinCode).filter(ChapterJoinCode.code == code).first()
    if not join_code or not join_code.is_active or is_join_code_expired(join_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired join code")

    new_membership = ChapterMembership(
        user_id=current_user.id,
        chapter_id=join_code.chapter_id,
        role="member",
    )
    join_code.use_count += 1

    try:
        db.add(new_membership)
        db.commit()
        db.refresh(new_membership)
        return new_membership
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already a member of a chapter")


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------

@router.get("/chapters/{chapter_id}/", response_model=ChapterResponse)
def get_chapter(
    chapter: AlumniChapter = Depends(find_chapter),
):
    """Get a chapter's name and university. Public — no member data is exposed here."""
    return chapter


# ---------------------------------------------------------------------------
# Chapter management — chapter lead or admin
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


# ---------------------------------------------------------------------------
# Members — chapter officer/lead or admin, unless noted otherwise
# ---------------------------------------------------------------------------

@router.get("/chapters/{chapter_id}/members/", response_model=list[ChapterMemberResponse])
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


@router.get("/chapters/{chapter_id}/members/{user_id}/profile/", response_model=ChapterMemberProfileResponse)
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


@router.patch("/chapters/{chapter_id}/members/{user_id}/", response_model=ChapterMemberResponse)
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


@router.delete("/chapters/{chapter_id}/members/{user_id}/", status_code=status.HTTP_204_NO_CONTENT)
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


# ---------------------------------------------------------------------------
# Join codes — chapter lead only
# ---------------------------------------------------------------------------

@router.get("/chapters/{chapter_id}/join-codes/", response_model=list[JoinCodeResponse])
def get_chapter_join_codes(
    chapter: AlumniChapter = Depends(find_chapter),
    db: Session = Depends(get_db),
    _: User = Depends(require_lead),
):
    """List every join code for a chapter, including expired and deactivated ones. Chapter lead only."""
    return db.query(ChapterJoinCode).with_parent(chapter, AlumniChapter.chapter_join_codes).all()


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

    join_code = ChapterJoinCode(
        chapter_id=chapter.id,
        created_by=user.id,
        code=get_unique_join_code(db, ChapterJoinCode),
        label=payload.label,
        expires_at=expires_at,
        is_active=True,
    )
    db.add(join_code)
    db.commit()
    db.refresh(join_code)
    return join_code


@router.patch("/chapters/{chapter_id}/join-codes/{code_id}/", response_model=JoinCodeResponse)
def update_chapter_join_code(
    code_id: int,
    payload: JoinCodeUpdate,
    chapter: AlumniChapter = Depends(find_chapter),
    user: User = Depends(require_lead),
    db: Session = Depends(get_db),
):
    """Update a join code's label, expiry, or deactivate it. Chapter lead only.

    Deactivation is one-way — is_active can only go True -> False; setting it
    back to True is rejected.
    """
    join_code = db.query(ChapterJoinCode).filter(ChapterJoinCode.id == code_id).first()
    if not join_code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Join code not found")
    if join_code.chapter_id != chapter.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Join code not found in this chapter")

    apply_join_code_patch(join_code, payload.model_dump(exclude_unset=True))

    db.commit()
    db.refresh(join_code)
    return join_code
