from __future__ import annotations
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session, selectinload

from app.core.auth import (
    get_current_user, require_admin, revoke_all_sessions, verify_password, clear_auth_cookie,
    get_current_session, revoke_all_other_sessions,
)
from app.core.users import find_user_by_id
from app.core.profile_status import compute_missing_profile_fields, is_profile_complete, is_onboarding_complete
from app.db.session import get_db
from app.models.models import User, UserCompetitionExperience, UserVolunteerExperience, Event, UserSession
from app.schemas.user import (
    UserFullResponse, UserMeFullResponse, UserSlimResponse,
    UserMeSlimResponse, UserUpdate, AdminUserUpdate
)
from app.schemas.auth import MessageResponse, AccountDeactivateRequest, AccountDeleteRequest
from app.schemas.session import SessionResponse

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
    """
    Admin can only update a user's role and status.

    Setting status="locked" also revokes every session for that user —
    locking is meant to cut off access immediately, not just block future
    logins, so a currently-logged-in device shouldn't stay usable.
    """
    user = find_user_by_id(db, user_id)
    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(user, field, value)

    if updates.get("status") == "locked":
        revoke_all_sessions(db, user.id)

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
# GET /users/me/ — current user's own profile. ?full=true for full response
# with experience lists eagerly loaded.
# ---------------------------------------------------------------------------
@router.get("/users/me/", response_model=None)
def get_me(
    full: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if full:
        user = (
            db.query(User)
            .options(
                selectinload(User.competition_experience).selectinload(UserCompetitionExperience.event).selectinload(Event.category),
                selectinload(User.volunteer_experience).selectinload(UserVolunteerExperience.event).selectinload(Event.category),
            )
            .filter(User.id == current_user.id)
            .first()
        )
        response = UserMeFullResponse.model_validate(user)
        response.missing_profile_fields = compute_missing_profile_fields(user)
        return response

    response = UserMeSlimResponse.model_validate(current_user)
    response.is_profile_complete = is_profile_complete(current_user, db=db)
    response.is_onboarding_complete = is_onboarding_complete(current_user)
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
    Email changes must go through the verify-before-apply flow
    (POST /auth/email/request-change/ + GET /auth/email/confirm-change/).
    """
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)

    response = UserMeFullResponse.model_validate(user)
    response.missing_profile_fields = compute_missing_profile_fields(user, db=db)
    return response


# ---------------------------------------------------------------------------
# POST /users/me/deactivate/ — authenticated self-service deactivation
# ---------------------------------------------------------------------------
@router.post("/users/me/deactivate/", status_code=status.HTTP_200_OK, response_model=MessageResponse,
    responses={401: {"description": "Current password is incorrect"}},
)
def deactivate_me(
    body: AccountDeactivateRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Reversible self-deactivation. Revokes every session for the user
    (including the one making this request) and clears the cookie on this
    response so the client isn't left holding a dead token.
    """
    if not user.hashed_password or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is incorrect")

    user.status = "deactivated"
    revoke_all_sessions(db, user.id)
    db.commit()

    clear_auth_cookie(response)
    return {"detail": "Account deactivated"}


# ---------------------------------------------------------------------------
# DELETE /users/me/ — authenticated self-service hard delete
# ---------------------------------------------------------------------------
@router.delete("/users/me/", status_code=status.HTTP_200_OK, response_model=MessageResponse,
    responses={401: {"description": "Current password is incorrect"}},
)
def delete_me(
    body: AccountDeleteRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Irreversible hard delete — cascades through TournamentMembership,
    sessions, verification tokens, etc. via DB-level ON DELETE CASCADE.
    """
    if not user.hashed_password or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is incorrect")

    db.delete(user)
    db.commit()

    clear_auth_cookie(response)
    return {"detail": "Account successfully deleted"}


# ---------------------------------------------------------------------------
# GET /users/me/sessions/ — list the current user's active sessions
# ---------------------------------------------------------------------------
@router.get("/users/me/sessions/", response_model=list[SessionResponse])
def list_my_sessions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    current_session: UserSession = Depends(get_current_session),
):
    """Lists active (not revoked, not expired) sessions, most recently active first."""
    now = datetime.now(timezone.utc)
    sessions = (
        db.query(UserSession)
        .filter(
            UserSession.user_id == user.id,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > now,
        )
        .order_by(UserSession.last_active_at.desc())
        .all()
    )

    return [
        SessionResponse(
            id=s.id,
            user_agent=s.user_agent,
            ip_address=s.ip_address,
            created_at=s.created_at,
            last_active_at=s.last_active_at,
            is_current=(s.id == current_session.id),
        )
        for s in sessions
    ]


# ---------------------------------------------------------------------------
# POST /users/me/sessions/logout-others/ — "log out everywhere" except here
# ---------------------------------------------------------------------------
@router.post("/users/me/sessions/logout-others/", status_code=status.HTTP_200_OK, response_model=MessageResponse)
def logout_other_sessions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    current_session: UserSession = Depends(get_current_session),
):
    """Revokes every session for the user except the one making this request."""
    revoke_all_other_sessions(db, user.id, current_session.id)
    return {"detail": "Logged out of all other sessions"}