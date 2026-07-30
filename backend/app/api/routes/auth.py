from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.auth import (
    create_session,
    get_active_session,
    get_client_ip,
    get_current_session,
    revoke_session,
    revoke_all_sessions,
    revoke_all_other_sessions,
    hash_password,
    verify_password,
    get_current_user,
    require_admin,
    set_auth_cookie,
    clear_auth_cookie,
    consume_verification_token,
    get_pending_email_change,
    RATE_LIMIT_WINDOW,
)
from app.core.users import check_if_email_exists, find_user_by_id, create_user
from app.db.session import get_db
from app.models.models import User, UserSession, VerificationToken
from app.schemas.user import UserSlimResponse
from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    AdminRegisterRequest,
    MessageResponse,
    EmailChangeRequest,
    EmailPendingChangeResponse,
    EmailChangeRevertConfirm,
    PasswordChangeRequest,
    PasswordResetRequest,
    PasswordResetConfirm,
    AccountSetupConfirm,
    AccountSetupResendRequest,
)
from app.services.email_service import (
    send_signup_verification_email,
    send_email_change_request_email,
    send_email_change_requested_notice,
    send_password_reset_request_email,
    send_password_changed_notice,
    send_account_setup_invite_email,
)
from datetime import datetime, timezone

router = APIRouter(tags=["auth"])


# ---------------------------------------------------------------------------
# Login / Logout
# ---------------------------------------------------------------------------

@router.post("/auth/login/", response_model=UserSlimResponse)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Authenticate with email + password.
    Sets an httpOnly session cookie on success.
    """
    user = db.query(User).filter(
        User.email == body.email.lower(),
        User.status == "active",
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

    raw_token = create_session(
        db, user.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=get_client_ip(request),
    )
    set_auth_cookie(response, raw_token)
    return user



@router.post("/auth/logout/", status_code=status.HTTP_200_OK)
def logout(
    response: Response,
    access_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
):
    """
    Revokes the current session (if the cookie still resolves to a valid
    one) and clears the cookie either way — logout should never error just
    because the session was already gone.
    """
    if access_token:
        session_row = get_active_session(db, access_token)
        if session_row is not None:
            revoke_session(db, session_row)
    clear_auth_cookie(response)
    return {"detail": "Logged out"}



# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

@router.post("/auth/register/", response_model=UserSlimResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Public route to create a new user account.
    All registered users get role="user".
    """
    check_if_email_exists(db, body.email)

    user = create_user(db, body.email, password=body.password)

    raw_token = create_session(
        db, user.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=get_client_ip(request),
    )
    set_auth_cookie(response, raw_token)

    return user



@router.post("/admin/auth/register/", response_model=UserSlimResponse, status_code=status.HTTP_201_CREATED)
async def admin_register(body: AdminRegisterRequest, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """
    Admin only. Can create normal users and admin users. Password is excluded to allow the newly created user
    to set their own via the account-setup invite email sent here.
    """
    check_if_email_exists(db, body.email)

    user = create_user(db, body.email, body.first_name, body.last_name, body.role, status="invited")
    await send_account_setup_invite_email(db, user.id, user.email)

    return user



# ---------------------------------------------------------------------------
# Signup email verification
# ---------------------------------------------------------------------------

@router.get("/auth/verify-email/", status_code=status.HTTP_200_OK, response_model=MessageResponse,
    responses={
        400: {"description": "Invalid or expired token"},
    },
)
def verify_email(token: str, db: Session = Depends(get_db)):
    """Consumes a signup_verify token and marks the user's email verified."""
    token_row = consume_verification_token(db, token, "signup_verify")
    if token_row is None:
        raise HTTPException(400, "Invalid or expired token")

    user = find_user_by_id(db, token_row.user_id)
    user.email_verified = True
    db.commit()
    return {"detail": "User email successfully verified"}

@router.post("/auth/send-email-verification/", status_code=status.HTTP_200_OK, response_model=MessageResponse,
    responses={
        400: {"description": "Email already verified"},
        429: {"description": "Verification email requested too recently"},
        500: {"description": "Failed to send verification email"},
    },
)
async def send_email_verification(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resends the signup verification email for the current user."""
    if user.email_verified:
        raise HTTPException(400, "Email already verified")

    await send_signup_verification_email(db, user.email, user.id)

    return {"detail": "Verification email successfully sent"}


# ---------------------------------------------------------------------------
# Email change
# ---------------------------------------------------------------------------

@router.get("/auth/email/pending-change/", status_code=status.HTTP_200_OK, response_model=EmailPendingChangeResponse)
def get_pending_email_change_route(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Whether the current user has an email change awaiting confirmation."""
    token_row = get_pending_email_change(db, user.id)
    if token_row is None:
        return EmailPendingChangeResponse()

    return EmailPendingChangeResponse(
        new_email=token_row.new_email,
        can_resend_at=token_row.created_at + RATE_LIMIT_WINDOW,
    )


@router.post("/auth/email/request-change/", status_code=status.HTTP_200_OK, response_model=EmailPendingChangeResponse,
    responses={
        409: {"description": "Email already registered to another account"},
        429: {"description": "Email change requested too recently"},
        500: {"description": "Failed to send confirmation email"},
    },
)
async def request_email_change(
    body: EmailChangeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Sends a confirmation link to the NEW address. user.email is untouched
    until that link is clicked — see confirm_email_change(). Also doubles
    as the resend route: the frontend calls this again with the same
    new_email to resend, rather than a separate no-arg resend endpoint.

    Also notifies the OLD address immediately (not on confirm) — user.email
    is still the original address here, so it's captured before anything
    is mutated. This is the only notice the account owner will see if they
    weren't the one who made the request.
    """
    check_if_email_exists(db, body.new_email, exclude_user_id=user.id)

    await send_email_change_request_email(db, user.id, body.new_email)
    await send_email_change_requested_notice(db, user.id, user.email, body.new_email)

    token_row = get_pending_email_change(db, user.id)
    return EmailPendingChangeResponse(
        new_email=token_row.new_email,
        can_resend_at=token_row.created_at + RATE_LIMIT_WINDOW,
    )


@router.get("/auth/email/confirm-change/", status_code=status.HTTP_200_OK, response_model=MessageResponse,
    responses={
        400: {"description": "Invalid or expired token"},
    },
)
async def confirm_email_change(token: str, db: Session = Depends(get_db)):
    """
    Clicking this link is itself proof of ownership of the new address,
    so email_verified is set true here — no separate re-verification needed.
    """
    token_row = consume_verification_token(db, token, "email_change")
    if token_row is None:
        raise HTTPException(400, "Invalid or expired token")

    user = find_user_by_id(db, token_row.user_id)

    user.email = token_row.new_email
    user.email_verified = True
    db.commit()

    return {"detail": "Email successfully updated"}


@router.post("/auth/email/revert/", status_code=status.HTTP_200_OK, response_model=MessageResponse,
    responses={
        400: {"description": "Invalid or expired token"},
    },
)
async def revert_email_change(body: EmailChangeRevertConfirm, db: Session = Depends(get_db)):
    """
    Consumes an email_change_revert token. Handles both cases in one route,
    since the token doesn't know which state it'll find things in:

    - Change was requested but never confirmed (still pending) — the
      email_change token is still valid/unconsumed. Cancel it so it can't
      be confirmed later. user.email is untouched since it was never
      mutated in the first place.
    - Change was already confirmed and applied — user.email currently holds
      the attacker's address. Revert it to the address stored on this token.

    Either branch, or both, end the same way: reaching this route at all
    means assume compromise — force a new password and revoke every
    session, don't do a partial fix.
    """
    token_row = consume_verification_token(db, body.token, "email_change_revert")
    if token_row is None:
        raise HTTPException(400, "Invalid or expired token")

    user = find_user_by_id(db, token_row.user_id)
    original_email = token_row.new_email  # reused column — see VerificationToken.new_email comment

    now = datetime.now(timezone.utc)

    # Case 1: still-pending email_change token — cancel it.
    pending = db.query(VerificationToken).filter(
        VerificationToken.user_id == user.id,
        VerificationToken.purpose == "email_change",
        VerificationToken.used_at.is_(None),
        VerificationToken.expires_at > now,
    ).first()
    if pending:
        pending.used_at = now

    # Case 2: already applied — this is a no-op if it wasn't.
    user.email = original_email
    user.email_verified = True  # assumes the original address was verified pre-takeover

    user.hashed_password = hash_password(body.new_password)
    db.commit()

    revoke_all_sessions(db, user.id)

    return {"detail": "Email reverted and account secured"}


# ---------------------------------------------------------------------------
# Password change (authenticated) / reset (logged out)
# ---------------------------------------------------------------------------

@router.post("/auth/password/change/", status_code=status.HTTP_200_OK, response_model=MessageResponse,
    responses={
        401: {"description": "Current password is incorrect"},
    },
)
async def change_password(
    body: PasswordChangeRequest,
    user: User = Depends(get_current_user),
    session: UserSession = Depends(get_current_session),
    db: Session = Depends(get_db),
):
    """Authenticated password change — requires current_password to match before setting new_password."""
    if not user.hashed_password or not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is incorrect")

    user.hashed_password = hash_password(body.new_password)
    db.commit()

    await send_password_changed_notice(user.email)
    revoke_all_other_sessions(db, user.id, session.id)

    return {"detail": "Password successfully changed"}


@router.post("/auth/password/reset/request/", status_code=status.HTTP_200_OK, response_model=MessageResponse)
async def request_password_reset(body: PasswordResetRequest, db: Session = Depends(get_db)):
    """
    Always returns the same generic response regardless of whether the
    email matches an account — avoids account enumeration. Pending
    admin-invited accounts (no password yet) are deliberately excluded:
    they should use account-setup, not password reset.
    """
    user = db.query(User).filter(
        User.email == body.email.lower(),
        User.status == "active",
    ).first()

    if user and user.hashed_password:
        try:
            await send_password_reset_request_email(db, user.id, user.email)
        except HTTPException as e:
            if e.status_code != 429:
                raise
            # Swallow rate-limit responses here too — surfacing a 429 vs.
            # the generic 200 would itself leak whether the email exists.

    return {"detail": "If an account exists for this email, a reset link has been sent."}


@router.post("/auth/password/reset/confirm/", status_code=status.HTTP_200_OK, response_model=MessageResponse,
    responses={
        400: {"description": "Invalid or expired token"},
    },
)
async def confirm_password_reset(body: PasswordResetConfirm, db: Session = Depends(get_db)):
    """Logged-out password reset — consumes a password_reset token and sets new_password."""
    token_row = consume_verification_token(db, body.token, "password_reset")
    if token_row is None:
        raise HTTPException(400, "Invalid or expired token")

    user = find_user_by_id(db, token_row.user_id)
    user.hashed_password = hash_password(body.new_password)
    db.commit()

    await send_password_changed_notice(user.email)
    revoke_all_sessions(db, user.id)

    return {"detail": "Password successfully reset"}


# ---------------------------------------------------------------------------
# Account setup (admin-created invite)
# ---------------------------------------------------------------------------

@router.post("/auth/account-setup/confirm/", response_model=UserSlimResponse, status_code=status.HTTP_200_OK,
    responses={
        400: {"description": "Invalid or expired token"},
    },
)
async def confirm_account_setup(
    body: AccountSetupConfirm,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Completes an admin-created account: sets the initial password. Logs the
    user in immediately, same as register(), since this mirrors sign-up's
    flow. Phone and any name correction happen afterward in onboarding.
    """
    token_row = consume_verification_token(db, body.token, "account_setup")
    if token_row is None:
        raise HTTPException(400, "Invalid or expired token")

    user = find_user_by_id(db, token_row.user_id)

    user.hashed_password = hash_password(body.password)
    user.status = "active"
    db.commit()
    db.refresh(user)

    raw_token = create_session(
        db, user.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=get_client_ip(request),
    )
    set_auth_cookie(response, raw_token)

    return user


@router.post("/admin/auth/account-setup/resend/", status_code=status.HTTP_200_OK, response_model=MessageResponse,
    responses={
        400: {"description": "Account setup already completed"},
        429: {"description": "Invite requested too recently"},
        500: {"description": "Failed to send invite email"},
    },
)
async def resend_account_setup(
    body: AccountSetupResendRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin-only — resends the account-setup invite for a pending (not yet activated) user."""
    user = find_user_by_id(db, body.user_id)

    if user.status != "invited":
        raise HTTPException(400, "Account setup already completed")

    await send_account_setup_invite_email(db, user.id, user.email)

    return {"detail": "Invite resent"}