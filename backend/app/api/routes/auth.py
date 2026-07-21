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
from app.core.users import check_if_email_exists, find_user_by_id
from app.core.email_verification import generate_verification_token, verify_verification_token
from app.core.profile_status import is_profile_complete
from app.db.session import get_db
from app.models.models import User
from app.schemas.user import UserMeSlimResponse, UserSlimResponse
from app.schemas.auth import LoginRequest, RegisterRequest, AdminRegisterRequest, MessageResponse
from app.services.email_service import send_verification_email

router = APIRouter( tags=["auth"])

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

def _create_user(
        db: Session,
        email: str,
        first_name: str,
        last_name: str,
        role: str,
        phone: Optional[str] = None,
        password: Optional[str] = None,
        is_active: bool = True
    ) -> User:

    user = User(
        email=email.lower(),
        phone=phone,
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
    
async def _send_verification_email(to: str, id: int):
    try:
        await send_verification_email(to, generate_verification_token(id))

    except Exception:
        raise HTTPException(500, "Failed to send verification email")


@router.post("/auth/login/", response_model=UserSlimResponse)
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


@router.post("/auth/logout/", status_code=status.HTTP_200_OK)
def logout(response: Response):
    """Clear the auth cookie."""
    _clear_auth_cookie(response)
    return {"detail": "Logged out"}


def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    response = UserMeSlimResponse.model_validate(current_user)
    response.is_profile_complete = is_profile_complete(current_user, db=db)
    return response


@router.post("/auth/register/", response_model=UserMeSlimResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    """
    Public route to create a new user account.
    All registered users get role="user".
    """
    check_if_email_exists(db, body.email)

    user = _create_user(db, body.email, body.first_name, body.last_name, "user", body.phone, body.password)

    token = create_access_token(user.id)
    _set_auth_cookie(response, token)

    return user

@router.post("/admin/auth/register/", response_model=UserSlimResponse, status_code=status.HTTP_201_CREATED)
def admin_register(body: AdminRegisterRequest, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """
    Admin only. Can create normal users and admin users. Password is excluded to allow the newly created user
    to set their own.
    """
    check_if_email_exists(db, body.email)

    return _create_user(db, body.email, body.first_name, body.last_name, body.role, is_active=False)

@router.get("/auth/verify-email/", status_code=status.HTTP_200_OK, response_model=MessageResponse,
    responses={
        400: {"description": "Invalid or expired token"},
        404: {"description": "User not found"},
    },
)
def verify_email(token: str, db: Session = Depends(get_db)):
    user_id = verify_verification_token(token)
    if user_id is None:
        raise HTTPException(400, "Invalid or expired token")
    
    user = find_user_by_id(db, user_id)
    user.email_verified = True
    db.commit()
    return {"detail": "User email successfully verified"}

# todo: add rate limiting
@router.post("/auth/send-email-verification/", status_code=status.HTTP_200_OK, response_model=MessageResponse,
    responses={
        400: {"description": "Email already verified"},
        500: {"description": "Failed to send verification email"},
    },
)
async def send_email_verification(user: User = Depends(get_current_user)):
    if user.email_verified:
        raise HTTPException(400, "Email already verified")
    
    await _send_verification_email(user.email, user.id)

    return {"detail": "Verification email successfully sent"}