from datetime import UTC, datetime

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Cookie,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)
from sqlalchemy.orm import Session

from app.core.auth import (
    DUMMY_PASSWORD_HASH,
    RATE_LIMIT_WINDOW,
    clear_auth_cookie,
    consume_verification_token,
    create_session,
    create_verification_token,
    get_active_session,
    get_client_ip,
    get_current_session,
    get_current_user,
    get_pending_email_change,
    hash_password,
    revoke_all_other_sessions,
    revoke_all_sessions,
    revoke_session,
    set_auth_cookie,
    verify_and_update_password,
    verify_password,
)
from app.core.users import check_if_email_exists, create_user, find_user_by_id
from app.db.session import get_db
from app.models.models import User, UserSession, VerificationToken
from app.schemas.auth import (
    AccountSetupConfirm,
    EmailChangeRequest,
    EmailChangeRevertConfirm,
    EmailPendingChangeResponse,
    LoginRequest,
    MessageResponse,
    PasswordChangeRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    RegisterRequest,
)
from app.schemas.user import AdminUserSlimResponse
from app.services.email_service import (
    send_email_change_email,
    send_email_change_requested_notice,
    send_in_background,
    send_password_changed_notice,
    send_password_reset_email,
    send_verification_email,
)

router = APIRouter(tags=["auth"])

# Every route is plain `def`, so FastAPI runs it in its threadpool: Argon2
# (~50 ms per hash) and the DB calls would otherwise stall the event loop.


# ---------------------------------------------------------------------------
# Login / Logout
# ---------------------------------------------------------------------------


@router.post("/auth/login/", response_model=AdminUserSlimResponse)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Authenticate with email + password.
    Sets an httpOnly session cookie on success.
    """
    user = (
        db.query(User)
        .filter(
            User.email == body.email.lower(),
            User.status == "active",
        )
        .first()
    )

    # Same error and the same hashing work whether the email or the password is
    # wrong, so neither the response nor its timing reveals which accounts exist.
    if not user or not user.hashed_password:
        verify_password(body.password, DUMMY_PASSWORD_HASH)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    valid, upgraded_hash = verify_and_update_password(body.password, user.hashed_password)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if upgraded_hash:
        # Legacy bcrypt hash: swap in Argon2. Committed by create_session below.
        user.hashed_password = upgraded_hash

    raw_token = create_session(
        db,
        user.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=get_client_ip(request),
    )
    set_auth_cookie(response, raw_token)
    return user


@router.post("/auth/logout/", status_code=status.HTTP_200_OK)
def logout(
    response: Response,
    access_token: str | None = Cookie(default=None),
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


@router.post(
    "/auth/register/", response_model=AdminUserSlimResponse, status_code=status.HTTP_201_CREATED
)
def register(
    body: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)
):
    """
    Public route to create a new user account.
    All registered users get role="user".
    """
    check_if_email_exists(db, body.email)

    user = create_user(db, body.email, password=body.password)

    raw_token = create_session(
        db,
        user.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=get_client_ip(request),
    )
    set_auth_cookie(response, raw_token)

    return user


# ---------------------------------------------------------------------------
# Signup email verification
# ---------------------------------------------------------------------------


@router.get(
    "/auth/verify-email/",
    status_code=status.HTTP_200_OK,
    response_model=MessageResponse,
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


@router.post(
    "/auth/send-email-verification/",
    status_code=status.HTTP_200_OK,
    response_model=MessageResponse,
    responses={
        400: {"description": "Email already verified"},
        429: {"description": "Verification email requested too recently"},
    },
)
def send_email_verification(
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resends the signup verification email for the current user."""
    if user.email_verified:
        raise HTTPException(400, "Email already verified")

    token = create_verification_token(db, user.id, "signup_verify")
    send_in_background(background_tasks, send_verification_email, user.email, token)

    return {"detail": "Verification email successfully sent"}


# ---------------------------------------------------------------------------
# Email change
# ---------------------------------------------------------------------------


@router.get(
    "/auth/email/pending-change/",
    status_code=status.HTTP_200_OK,
    response_model=EmailPendingChangeResponse,
)
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


@router.post(
    "/auth/email/request-change/",
    status_code=status.HTTP_200_OK,
    response_model=EmailPendingChangeResponse,
    responses={
        409: {"description": "Email already registered to another account"},
        429: {"description": "Email change requested too recently"},
    },
)
def request_email_change(
    body: EmailChangeRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Emails a confirmation link to the new address, and a notice with an undo
    link to the current one. The account email changes only once the link is
    confirmed. Call again with the same new_email to resend.
    """
    check_if_email_exists(db, body.new_email, exclude_user_id=user.id)

    token = create_verification_token(db, user.id, "email_change", new_email=body.new_email)
    # The undo link goes out now, not on confirm, so the owner can stop a change
    # they didn't make; once it's applied, /forgot-password would reach the new address.
    revert_token = create_verification_token(
        db, user.id, "email_change_revert", new_email=user.email
    )
    send_in_background(background_tasks, send_email_change_email, body.new_email, token)
    send_in_background(
        background_tasks,
        send_email_change_requested_notice,
        user.email,
        body.new_email,
        revert_token,
    )

    token_row = get_pending_email_change(db, user.id)
    assert token_row is not None
    return EmailPendingChangeResponse(
        new_email=token_row.new_email,
        can_resend_at=token_row.created_at + RATE_LIMIT_WINDOW,
    )


@router.get(
    "/auth/email/confirm-change/",
    status_code=status.HTTP_200_OK,
    response_model=MessageResponse,
    responses={
        400: {"description": "Invalid or expired token"},
    },
)
def confirm_email_change(token: str, db: Session = Depends(get_db)):
    """
    Clicking this link is itself proof of ownership of the new address,
    so email_verified is set true here — no separate re-verification needed.
    """
    token_row = consume_verification_token(db, token, "email_change")
    if token_row is None:
        raise HTTPException(400, "Invalid or expired token")
    assert token_row.new_email is not None

    user = find_user_by_id(db, token_row.user_id)

    user.email = token_row.new_email
    user.email_verified = True
    db.commit()

    return {"detail": "Email successfully updated"}


@router.post(
    "/auth/email/revert/",
    status_code=status.HTTP_200_OK,
    response_model=MessageResponse,
    responses={
        400: {"description": "Invalid or expired token"},
    },
)
def revert_email_change(body: EmailChangeRevertConfirm, db: Session = Depends(get_db)):
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
    assert original_email is not None

    now = datetime.now(UTC)

    # Case 1: still-pending email_change token — cancel it.
    pending = (
        db.query(VerificationToken)
        .filter(
            VerificationToken.user_id == user.id,
            VerificationToken.purpose == "email_change",
            VerificationToken.used_at.is_(None),
            VerificationToken.expires_at > now,
        )
        .first()
    )
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


@router.post(
    "/auth/password/change/",
    status_code=status.HTTP_200_OK,
    response_model=MessageResponse,
    responses={
        401: {"description": "Current password is incorrect"},
    },
)
def change_password(
    body: PasswordChangeRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    session: UserSession = Depends(get_current_session),
    db: Session = Depends(get_db),
):
    """Authenticated password change — requires current_password to match before setting new_password."""
    if not user.hashed_password or not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is incorrect")

    user.hashed_password = hash_password(body.new_password)
    db.commit()

    send_in_background(background_tasks, send_password_changed_notice, user.email)
    revoke_all_other_sessions(db, user.id, session.id)

    return {"detail": "Password successfully changed"}


@router.post(
    "/auth/password/reset/request/", status_code=status.HTTP_200_OK, response_model=MessageResponse
)
def request_password_reset(
    body: PasswordResetRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Always returns the same generic response regardless of whether the
    email matches an account — avoids account enumeration. Pending
    admin-invited accounts (no password yet) are deliberately excluded:
    they should use account-setup, not password reset.
    """
    user = (
        db.query(User)
        .filter(
            User.email == body.email.lower(),
            User.status == "active",
        )
        .first()
    )

    if user and user.hashed_password:
        try:
            token = create_verification_token(db, user.id, "password_reset")
        except HTTPException:
            pass  # A 429 instead of the generic 200 would reveal that the account exists.
        else:
            send_in_background(background_tasks, send_password_reset_email, user.email, token)

    return {"detail": "If an account exists for this email, a reset link has been sent."}


@router.post(
    "/auth/password/reset/confirm/",
    status_code=status.HTTP_200_OK,
    response_model=MessageResponse,
    responses={
        400: {"description": "Invalid or expired token"},
    },
)
def confirm_password_reset(
    body: PasswordResetConfirm,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Logged-out password reset — consumes a password_reset token and sets new_password."""
    token_row = consume_verification_token(db, body.token, "password_reset")
    if token_row is None:
        raise HTTPException(400, "Invalid or expired token")

    user = find_user_by_id(db, token_row.user_id)
    user.hashed_password = hash_password(body.new_password)
    db.commit()

    send_in_background(background_tasks, send_password_changed_notice, user.email)
    revoke_all_sessions(db, user.id)

    return {"detail": "Password successfully reset"}


# ---------------------------------------------------------------------------
# Account setup
#
# Dormant: no producer currently mints an 'account_setup' token, so no user
# can reach status="invited" and this route is unreachable. Kept for the
# invite flow's eventual producer (a TD pre-provisioning staff) — note that a
# producer also needs an invite-resend route, since a 7-day account_setup
# token otherwise expires with no recovery path.
# ---------------------------------------------------------------------------


@router.post(
    "/auth/account-setup/confirm/",
    response_model=AdminUserSlimResponse,
    status_code=status.HTTP_200_OK,
    responses={
        400: {"description": "Invalid or expired token"},
    },
)
def confirm_account_setup(
    body: AccountSetupConfirm,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Completes an invited account: sets the initial password. Logs the user in
    immediately, same as register(), since this mirrors sign-up's flow. Phone
    and any name correction happen afterward in onboarding.
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
        db,
        user.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=get_client_ip(request),
    )
    set_auth_cookie(response, raw_token)

    return user
