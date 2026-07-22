from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_admin
from app.core.users import check_if_email_exists, find_user_by_id
from app.core.profile_status import compute_missing_profile_fields
from app.db.session import get_db
from app.models.models import User
from app.schemas.user import UserFullResponse, UserMeFullResponse, UserSlimResponse, UserUpdate, AdminUserUpdate

router = APIRouter(tags=["users"])


# ---------------------------------------------------------------------------
# GET /users/ — admin only (global unscoped list)
# ---------------------------------------------------------------------------
@router.get("/admin/users/", response_model=list[UserSlimResponse])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Global user list. Admin only."""
    return db.query(User).order_by(User.last_name, User.first_name).all()


# ---------------------------------------------------------------------------
# GET /users/{user_id}/ — admin only
# ---------------------------------------------------------------------------
@router.get("/admin/users/{user_id}/", response_model=UserFullResponse)
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


# ---------------------------------------------------------------------------
# GET /users/by-email/{email}/ — admin only
# ---------------------------------------------------------------------------
@router.get("/admin/users/by-email/{email}/", response_model=UserFullResponse)
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


# ---------------------------------------------------------------------------
# PATCH /admin/users/{user_id}/ — admin only
# ---------------------------------------------------------------------------
@router.patch("/admin/users/{user_id}/", response_model=UserSlimResponse)
def admin_update_user(
    user_id: int,
    body: AdminUserUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin)
):
    """Admin can only update a user's role and is_active status."""
    user = find_user_by_id(db, user_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user

# ---------------------------------------------------------------------------
# DELETE /admin/users/{user_id}/ — admin only
# ---------------------------------------------------------------------------
@router.delete("/admin/users/{user_id}/", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_user(
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
# GET /users/me/
# ---------------------------------------------------------------------------
@router.get("/users/me/", response_model=UserMeFullResponse)
def get_me(current_user: User = Depends(get_current_user)):
    response = UserMeFullResponse.model_validate(current_user)
    response.missing_profile_fields = compute_missing_profile_fields(current_user)
    return response


# ---------------------------------------------------------------------------
# PATCH /users/me/ — authenticated user updates their own profile
# ---------------------------------------------------------------------------
@router.patch("/users/me/", response_model=UserMeFullResponse)
def update_user_me(
    body: UserUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """
    Update the current user's own profile.
    Omitted fields are left unchanged. Explicit null clears a field.
    Email uniqueness is checked before applying changes.
    """
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "email":
            check_if_email_exists(db, body.email, exclude_user_id=user.id)
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    
    response = UserMeFullResponse.model_validate(user)
    response.missing_profile_fields = compute_missing_profile_fields(user, db=db)
    return response