from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import TournamentCategory, Event, User
from app.schemas.tournament_category import TournamentCategoryCreate, TournamentCategoryRead
from app.core.permissions import MANAGE_EVENTS, VIEW_EVENTS, require_permission

router = APIRouter(prefix="/tournaments/{tournament_id}/categories", tags=["categories"])


@router.get("/", response_model=list[TournamentCategoryRead])
def list_categories(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(VIEW_EVENTS)),
):
    """List all categories for a tournament (seeded + custom)."""
    return (
        db.query(TournamentCategory)
        .filter(TournamentCategory.tournament_id == tournament_id)
        .all()
    )


@router.post("/", response_model=TournamentCategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(
    tournament_id: int,
    payload: TournamentCategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    """Create a new custom category."""
    # Check if category with same name already exists
    existing = (
        db.query(TournamentCategory)
        .filter(
            TournamentCategory.tournament_id == tournament_id,
            TournamentCategory.name == payload.name,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists")

    db_cat = TournamentCategory(
        **payload.model_dump(),
        tournament_id=tournament_id,
        is_custom=True,
    )
    db.add(db_cat)
    db.commit()
    db.refresh(db_cat)
    return db_cat


@router.delete("/{cat_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    tournament_id: int,
    cat_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    """Delete a custom category. Seeded categories cannot be deleted."""
    db_cat = (
        db.query(TournamentCategory)
        .filter(
            TournamentCategory.id == cat_id,
            TournamentCategory.tournament_id == tournament_id,
        )
        .first()
    )
    if not db_cat:
        raise HTTPException(status_code=404, detail="Category not found")

    if not db_cat.is_custom:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Seeded categories cannot be deleted",
        )

    # Check for events using this category
    if db_cat.events:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This category is in use and cannot be deleted.",
        )

    db.delete(db_cat)
    db.commit()
