from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import University


def create_university_record(
    db: Session, name: str, abbreviation: str | None = None, location: str | None = None
) -> University:

    university = University(name=name, abbreviation=abbreviation, location=location)
    db.add(university)
    db.commit()
    db.refresh(university)
    return university


def check_if_university_exists(db: Session, name: str):
    existing = db.query(University).filter(University.name == name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="University already exists"
        )


def find_university(university_id: int, db: Session = Depends(get_db)) -> University:
    university = db.query(University).filter(University.id == university_id).first()
    if not university:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="University not found")
    return university
