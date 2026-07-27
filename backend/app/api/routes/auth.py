from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.auth import (
    create_access_token,
    hash_password,
    verify_password,
    get_current_user,
    require_admin,
    set_auth_cookie,
    clear_auth_cookie,
)
from app.core.users import check_if_email_exists, find_user_by_id, create_user
from app.core.email_verification import verify_verification_token
from app.db.session import get_db
from app.models.models import User
from app.schemas.user import UserSlimResponse
from app.schemas.auth import LoginRequest, RegisterRequest, AdminRegisterRequest, MessageResponse
from app.services.email_service import send_signup_verification_email

router = APIRouter(tags=["auth"])


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
    set_auth_cookie(response, token)
    return user



@router.post("/auth/logout/", status_code=status.HTTP_200_OK)
def logout(response: Response):
    """Clear the auth cookie."""
    clear_auth_cookie(response)
    return {"detail": "Logged out"}



@router.post("/auth/register/", response_model=UserSlimResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    """
    Public route to create a new user account.
    All registered users get role="user".
    """
    check_if_email_exists(db, body.email)

    user = create_user(db, body.email, body.first_name, body.last_name, "user", body.phone, body.password)

    token = create_access_token(user.id)
    set_auth_cookie(response, token)

    return user



@router.post("/admin/auth/register/", response_model=UserSlimResponse, status_code=status.HTTP_201_CREATED)
def admin_register(body: AdminRegisterRequest, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """
    Admin only. Can create normal users and admin users. Password is excluded to allow the newly created user
    to set their own.
    """
    check_if_email_exists(db, body.email)

    return create_user(db, body.email, body.first_name, body.last_name, body.role, is_active=False)



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
    
    await send_signup_verification_email(user.email, user.id)

    return {"detail": "Verification email successfully sent"}