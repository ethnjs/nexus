from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session, selectinload

from app.core.auth import (
    clear_auth_cookie,
    create_verification_token,
    get_current_session,
    get_current_user,
    require_admin,
    revoke_all_other_sessions,
    revoke_all_sessions,
    verify_password,
)
from app.core.email_codes import require_recent_code, start_admin_sign_in_code
from app.core.profile_status import (
    compute_missing_profile_fields,
    is_onboarding_complete,
    is_profile_complete,
)
from app.core.users import check_if_email_exists, find_user_by_id, require_not_last_admin
from app.db.session import get_db
from app.models.models import (
    EmailCode,
    Event,
    User,
    UserCompetitionExperience,
    UserSession,
    UserVolunteerExperience,
    VerificationToken,
)
from app.schemas.auth import (
    AccountDeactivateRequest,
    AccountDeleteRequest,
    AdminSignInCodeResponse,
    MessageResponse,
)
from app.schemas.session import SessionResponse
from app.schemas.user import (
    AdminUserFullResponse,
    AdminUserSlimResponse,
    AdminUserUpdate,
    UserMeFullResponse,
    UserMeSlimResponse,
    UserUpdate,
)
from app.services.email_service import send_in_background, send_password_reset_email

logger = logging.getLogger(__name__)

router = APIRouter(tags=["users"])


# ---------------------------------------------------------------------------
# GET /admin/users/ — admin only (global unscoped list)
# ---------------------------------------------------------------------------
@router.get("/admin/users/", response_model=list[AdminUserSlimResponse])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Global user list. Admin only."""
    return db.query(User).order_by(User.last_name, User.first_name).all()


# ---------------------------------------------------------------------------
# GET /admin/users/{user_id}/ — admin only
# ---------------------------------------------------------------------------
@router.get("/admin/users/{user_id}/", response_model=AdminUserFullResponse)
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
# GET /admin/users/by-email/{email}/ — admin only
# ---------------------------------------------------------------------------
@router.get("/admin/users/by-email/{email}/", response_model=AdminUserFullResponse)
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
@router.patch(
    "/admin/users/{user_id}/",
    response_model=AdminUserSlimResponse,
    responses={403: {"description": "A fresh code is needed first (detail.code step_up_required)"}},
)
def admin_update_user(
    user_id: int,
    body: AdminUserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
    session: UserSession = Depends(get_current_session),
):
    """
    Admin can update a user's role, status, and email. Changing the role or email needs a code
    entered in the last 10 minutes; see POST /auth/step-up/. A new email is unverified until the
    user next signs in with a code sent to it, and codes and links sent to the old one stop
    working.

    Moving a user off status="active" revokes every session they hold. Losing
    access is meant to take effect now, not at their next sign-in — login
    already refuses any non-active status, so leaving live sessions alone
    would let a logged-in device keep working indefinitely.

    An admin cannot demote or deactivate themselves through this route. Both
    are irreversible from the caller's side — the demote drops the very
    permission needed to undo it, and the deactivate revokes their session on
    the way out — so a misclick on your own row would need another admin to
    fix. Deliberate self-deactivation still exists at POST
    /users/me/deactivate/, where it is password-confirmed.
    """
    user = find_user_by_id(db, user_id)
    updates = body.model_dump(exclude_unset=True)

    if "role" in updates and updates["role"] != user.role:
        require_recent_code(session)

    email = updates.pop("email", None)
    if email is not None and email.lower() != user.email:
        require_recent_code(session)
        check_if_email_exists(db, email, exclude_user_id=user.id)
        user.email = email.lower()
        user.email_verified = False
        # Codes and links already mailed to the old address stop working.
        now = datetime.now(UTC)
        db.query(EmailCode).filter(
            EmailCode.user_id == user.id,
            EmailCode.purpose != "admin_sign_in",
            EmailCode.consumed_at.is_(None),
        ).update({"consumed_at": now}, synchronize_session=False)
        db.query(VerificationToken).filter(
            VerificationToken.user_id == user.id, VerificationToken.used_at.is_(None)
        ).update({"used_at": now}, synchronize_session=False)

    if user.id == current_user.id:
        if updates.get("role") == "user":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot demote your own account",
            )
        if "status" in updates and updates["status"] != "active":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot deactivate your own account here — use account settings",
            )

    for field, value in updates.items():
        setattr(user, field, value)

    if "status" in updates and updates["status"] != "active":
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
    current_user: User = Depends(require_admin),
):
    """Delete any user. Admin only. Irreversible.

    Everything personal goes: profile, experience, sessions, chapter and
    tournament memberships, form responses. Things they made for other people
    stay as history with the credit nulled — tournaments they own (left
    ownerless until an admin transfers them), forms, join codes, audit entries.
    See the SET NULL FKs on those models.

    Not yourself, though: deleting the account you are acting with is an
    irreversible accident, and the self-service DELETE /users/me/ exists for
    when it is genuinely intended (and asks for a password).
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account",
        )

    db.delete(user)
    db.commit()


# ---------------------------------------------------------------------------
# POST /admin/users/{user_id}/password-reset/ — admin only
# ---------------------------------------------------------------------------
@router.post(
    "/admin/users/{user_id}/password-reset/",
    status_code=status.HTTP_200_OK,
    response_model=MessageResponse,
    responses={
        400: {"description": "User has no password to reset"},
        429: {"description": "Reset requested too recently"},
    },
)
def admin_send_password_reset(
    user_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """
    Sends the same reset email the public forgot-password flow sends, on an
    admin's behalf. Unlike that route, it reports a 429 instead of a uniform
    200, since an admin already knows the account exists.

    Status isn't checked: a deactivated or locked user still can't log in, so
    resetting their password is harmless, and blocking it would get in the way
    of the reset-then-reactivate sequence.
    """
    user = find_user_by_id(db, user_id)

    # No password means the account was never set up — that needs the
    # account-setup invite, not a reset. Same exclusion the public route makes.
    if not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no password set",
        )

    token = create_verification_token(db, user.id, "password_reset")
    send_in_background(background_tasks, send_password_reset_email, user.email, token)

    return {"detail": "Password reset email sent"}


# ---------------------------------------------------------------------------
# POST /admin/users/{user_id}/sign-in-code/ — admin only
# ---------------------------------------------------------------------------
@router.post(
    "/admin/users/{user_id}/sign-in-code/",
    status_code=status.HTTP_201_CREATED,
    response_model=AdminSignInCodeResponse,
    responses={
        400: {"description": "User has no password set"},
        403: {"description": "A fresh code is needed first (detail.code step_up_required)"},
    },
)
def admin_create_sign_in_code(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _: UserSession = Depends(require_recent_code),
):
    """
    Issues a one-time sign-in code for a user whose emails aren't arriving. They still enter
    their password, then type this code where the emailed one would go. It works once, expires
    in 30 minutes, and replaces any earlier one. The code appears only in this response. Needs a
    code entered in the last 10 minutes; see POST /auth/step-up/.
    """
    user = find_user_by_id(db, user_id)
    if not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no password set",
        )

    code, row = start_admin_sign_in_code(db, user, admin)
    logger.warning("Admin %s issued a one-time sign-in code for user %s", admin.id, user.id)
    return AdminSignInCodeResponse(code=code, expires_at=row.expires_at)


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
                selectinload(User.competition_experience)
                .selectinload(UserCompetitionExperience.event)
                .selectinload(Event.category),
                selectinload(User.volunteer_experience)
                .selectinload(UserVolunteerExperience.event)
                .selectinload(Event.category),
            )
            .filter(User.id == current_user.id)
            .first()
        )
        assert user is not None
        response = UserMeFullResponse.model_validate(user, from_attributes=True)
        response.missing_profile_fields = compute_missing_profile_fields(user)
        return response

    response = UserMeSlimResponse.model_validate(current_user)
    response.is_profile_complete = is_profile_complete(current_user, db=db)
    response.is_onboarding_complete = is_onboarding_complete(current_user, db=db)
    return response


# ---------------------------------------------------------------------------
# PATCH /users/me/ — authenticated user updates their own profile
# ---------------------------------------------------------------------------
@router.patch("/users/me/", response_model=UserMeFullResponse)
def update_user_me(
    body: UserUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
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

    response = UserMeFullResponse.model_validate(user, from_attributes=True)
    response.missing_profile_fields = compute_missing_profile_fields(user, db=db)
    return response


# ---------------------------------------------------------------------------
# POST /users/me/deactivate/ — authenticated self-service deactivation
# ---------------------------------------------------------------------------
@router.post(
    "/users/me/deactivate/",
    status_code=status.HTTP_200_OK,
    response_model=MessageResponse,
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

    require_not_last_admin(db, user)

    user.status = "deactivated"
    revoke_all_sessions(db, user.id)
    db.commit()

    clear_auth_cookie(response)
    return {"detail": "Account deactivated"}


# ---------------------------------------------------------------------------
# DELETE /users/me/ — authenticated self-service hard delete
# ---------------------------------------------------------------------------
@router.delete(
    "/users/me/",
    status_code=status.HTTP_200_OK,
    response_model=MessageResponse,
    responses={401: {"description": "Current password is incorrect"}},
)
def delete_me(
    body: AccountDeleteRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Irreversible hard delete — same reach as the admin delete above: personal
    data cascades away, owned tournaments and other credited rows survive
    with the user reference nulled.
    """
    if not user.hashed_password or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is incorrect")

    require_not_last_admin(db, user)

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
    now = datetime.now(UTC)
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
@router.post(
    "/users/me/sessions/logout-others/",
    status_code=status.HTTP_200_OK,
    response_model=MessageResponse,
)
def logout_other_sessions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    current_session: UserSession = Depends(get_current_session),
):
    """Revokes every session for the user except the one making this request."""
    revoke_all_other_sessions(db, user.id, current_session.id)
    return {"detail": "Logged out of all other sessions"}
