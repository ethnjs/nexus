from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session
from typing import Optional

from app.core.auth import (
    create_access_token,
    hash_password,
    verify_password,
    get_current_user,
    require_admin,
)
from app.core.config import get_settings
from app.db.session import get_db
from app.models.models import User
from app.schemas.auth import LoginRequest, RegisterRequest, AdminRegisterRequest, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME = "access_token"
COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days in seconds


def _set_auth_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    is_prod = settings.app_env == "production"
    is_preview = settings.app_env == "preview"
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=is_prod or is_preview,
        samesite="none" if (is_prod or is_preview) else "lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
        domain=".ethanshih.com" if is_prod else None,
    )


def _clear_auth_cookie(response: Response) -> None:
    settings = get_settings()
    is_prod = settings.app_env == "production"
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        domain=".ethanshih.com" if is_prod else None,
    )

def _check_if_user_exists(db: Session, email: str):
    existing = db.query(User).filter(User.email == email.lower()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

def _create_user(
        db: Session,
        email: str,
        first_name: str,
        last_name: str,
        role: str,
        password: Optional[str] = None,
        is_active: bool = True
    ) -> User:

    user = User(
        email=email.lower(),
        hashed_password=hash_password(password) if password else None,
        first_name=first_name,
        last_name=last_name,
        role=role,
        is_active=is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
    

@router.post("/login/", response_model=UserResponse)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    """
    Authenticate with email + password.
    Sets an httpOnly JWT cookie on success.
    """
    user = db.query(User).filter(
        User.email == body.email.lower(),
        User.is_active == True,
    ).first()

    # Deliberate: same error whether email or password is wrong — prevents enumeration
    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = create_access_token(user.id)
    _set_auth_cookie(response, token)
    return user


@router.post("/logout/", status_code=status.HTTP_200_OK)
def logout(response: Response):
    """Clear the auth cookie."""
    _clear_auth_cookie(response)
    return {"detail": "Logged out"}


@router.get("/me/", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user."""
    return current_user


@router.post("/register/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    """
    Public route to create a new user account.
    All registered users get role="user".
    """
    _check_if_user_exists(db, body.email)

    user = _create_user(db, body.email, body.first_name, body.last_name, "user", body.password)

    token = create_access_token(user.id)
    _set_auth_cookie(response, token)

    return user

@router.post("/admin/register/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def admin_register(body: AdminRegisterRequest, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """
    Admin only. Can create normal users and admin users. Password is excluded to allow the newly created user
    to set their own.
    """
    _check_if_user_exists(db, body.email)

    return _create_user(db, body.email, body.first_name, body.last_name, body.role, is_active=False)