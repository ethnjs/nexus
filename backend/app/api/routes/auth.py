from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

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
from app.schemas.auth import LoginRequest, RegisterRequest, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME = "access_token"
COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days in seconds


def _set_auth_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    is_prod = settings.app_env == "production"
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,                          # not accessible to JS — XSS protection
        secure=is_prod,                         # HTTPS only in prod
        samesite="lax" if not is_prod else "none",  # "none" required for cross-origin in prod
        max_age=COOKIE_MAX_AGE,
        path="/",
    )


@router.post("/login", response_model=UserResponse)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    """
    Authenticate with email + password.
    Sets an httpOnly JWT cookie on success.
    """
    user = db.query(User).filter(
        User.email == body.email.lower(),
        User.is_active == True,
    ).first()

    # Deliberate: same error message whether email or password is wrong
    # prevents user enumeration attacks
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


@router.post("/logout", status_code=status.HTTP_200_OK)
def logout(response: Response):
    """Clear the auth cookie."""
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"detail": "Logged out"}


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user."""
    return current_user


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(
    body: RegisterRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """
    Create a new TD (or admin) account.
    Admin-only — TDs cannot self-register.
    """
    if body.role not in ("admin", "td", "volunteer"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="role must be one of: admin, td, volunteer",
        )

    existing = db.query(User).filter(User.email == body.email.lower()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(
        email=body.email.lower(),
        hashed_password=hash_password(body.password),
        first_name=body.first_name,
        last_name=body.last_name,
        role=body.role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user