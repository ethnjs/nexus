from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.core.universities import check_if_university_exists, create_university_record, find_university
from app.db.session import get_db
from app.models.models import AlumniChapter, TournamentTrack, University, User
from app.schemas.university import UniversityCreate, UniversityResponse, UniversityUpdate

router = APIRouter(tags=["universities"])


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------

@router.get("/universities/", response_model=list[UniversityResponse])
def get_universities(db: Session = Depends(get_db)):
    """List every university. Public."""
    return db.query(University).order_by(University.name).all()


# ---------------------------------------------------------------------------
# Admin: university CRUD
# ---------------------------------------------------------------------------

@router.post("/admin/universities/", response_model=UniversityResponse, status_code=status.HTTP_201_CREATED)
def create_university(
    body: UniversityCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Create a new university. Admin only. 409 if the name is already taken."""
    check_if_university_exists(db, body.name)
    return create_university_record(db, body.name, body.abbreviation, body.location)


@router.patch("/admin/universities/{university_id}/", response_model=UniversityResponse)
def update_university(
    payload: UniversityUpdate,
    university: University = Depends(find_university),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Update a university's name, abbreviation, or location. Admin only."""
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(university, field, value)
    db.commit()
    db.refresh(university)
    return university


@router.delete("/admin/universities/{university_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_university(
    university: University = Depends(find_university),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Delete a university. Admin only. 409 if anything still references it."""
    has_chapters = db.query(AlumniChapter).filter(AlumniChapter.university_id == university.id).first()
    if has_chapters:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Referenced by Alumni Chapter.")
    has_users = db.query(User).filter(User.university_id == university.id).first()
    if has_users:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Referenced by one or more Users.")
    # Tracks are the third referrer and were missing. Without this, a
    # university only a track pointed at passed both checks above and the
    # delete went through — SQLAlchemy nulls the track's university_id on the
    # way, leaving a primary track with neither a university nor a location,
    # which _validate_track_source rejects as a 500. A TD setting a venue
    # nobody lists on their profile is all it takes to get there.
    has_tracks = db.query(TournamentTrack).filter(TournamentTrack.university_id == university.id).first()
    if has_tracks:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Referenced by one or more tournament tracks.",
        )
    db.delete(university)
    db.commit()
