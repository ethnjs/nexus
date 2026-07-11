from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.models.models import User, University, AlumniChapter
from app.db.session import get_db
from app.schemas.university import UniversityCreate, UniversityUpdate, UniversityResponse
from app.core.universities import _create_university, check_if_university_exists

router = APIRouter( tags=["universities"])


@router.get("/universities/", response_model=list[UniversityResponse])
def get_universities(db: Session = Depends(get_db)):
    """Get a list of all universities."""
    return db.query(University).order_by(University.name).all()

@router.post("/admin/universities/", response_model=UniversityResponse, status_code=status.HTTP_201_CREATED)
def create_university(
    body: UniversityCreate, 
    db: Session = Depends(get_db), 
    _: User = Depends(require_admin)
):
    """Create a new university. Admin only."""
    check_if_university_exists(db, body.name)

    return _create_university(db, body.name, body.abbreviation, body.location)

@router.patch("/universities/", response_model=UniversityResponse)
def update_university(
    university_id: int, 
    payload: UniversityUpdate, 
    db: Session = Depends(get_db), 
    _: User = Depends(require_admin)
):
    """Update existing university from id. Admin only."""
    university = db.query(University).filter(University.id == university_id).first()
    if not university:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="University not found")
    for field, value in payload.model_dump(exclude_unset=True).itmes():
        setattr(university, field, value)
    db.commit()
    db.refresh(university)
    return university

@router.delete("/universities", status_code=status.HTTP_204_NO_CONTENT)
def delete_university(
    university_id: int, 
    db: Session = Depends(get_db), 
    _: User = Depends(require_admin)
):
    """Delete existing university from id. Admin only."""
    university = db.query(University).filter(University.id == university_id).first()
    if not university:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="University not found")
    has_chapters = db.query(AlumniChapter).filter(AlumniChapter.university_id == university_id).first()
    if has_chapters:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Referenced by Alumni Chapter.")
    has_users = db.query(User).filter(User.university_id == university.id).first()
    if has_users:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Referenced by one or more Users.")
    db.delete(university)
    db.commit()