from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_admin
from app.core.permissions import MANAGE_TOURNAMENT, MANAGE_VOLUNTEERS, has_permission
from app.db.session import get_db
from app.models.models import Membership, User
from app.schemas.user import UserCreate, UserRead, UserUpdate

router = APIRouter(tags=["users"])


# ---------------------------------------------------------------------------
# GET /users/ — admin only (global unscoped list)
# ---------------------------------------------------------------------------
@router.get("/users/", response_model=list[UserRead])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Global user list. Admin only."""
    return db.query(User).order_by(User.last_name, User.first_name).all()


@router.post("/users/", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Create a bare user record. Admin only."""
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User with email '{payload.email}' already exists",
        )
    user = User(**payload.model_dump())
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/users/{user_id}/", response_model=UserRead)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Get any user by ID. Admin only."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.get("/users/by-email/{email}/", response_model=UserRead)
def get_user_by_email(
    email: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Get any user by email. Admin only."""
    user = db.query(User).filter(User.email == email.lower().strip()).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.patch("/users/{user_id}/", response_model=UserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Update any user. Admin only."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Delete any user. Admin only."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    db.delete(user)
    db.commit()


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/users/{user_id}
# Requires manage_volunteers or manage_tournament for that tournament.
# ---------------------------------------------------------------------------
@router.get("/tournaments/{tournament_id}/users/{user_id}/", response_model=UserRead)
def get_tournament_user(
    tournament_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a specific user who is a member of a tournament.
    Requires manage_volunteers or manage_tournament in that tournament.
    Returns 404 if the user is not a member of the tournament.
    """
    if not (
        has_permission(current_user, tournament_id, MANAGE_VOLUNTEERS, db)
        or has_permission(current_user, tournament_id, MANAGE_TOURNAMENT, db)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )

    # Verify the user actually has a membership in this tournament
    membership = db.query(Membership).filter(
        Membership.user_id == user_id,
        Membership.tournament_id == tournament_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in this tournament")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user