from pydantic import BaseModel, EmailStr, field_validator, model_validator
from typing import Optional, Literal
from datetime import datetime

from app.core.phone import normalize_phone as _normalize_phone


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

PASSWORD_ERROR_MSG: dict[str, str] = {
    "length": "Password must have a length of 8 or more characters.\n",
    "upper": "Password must include at least one uppercase letter.\n",
    "lower": "Password must include at least one lowercase letter.\n",
    "number": "Password must include at least one number.\n",
    "symbol": "Password must include at least one special symbol.\n",
    "valid": "Password contains an invalid character.\n"
}


def validate_password_strength(password: str) -> str:
    """
    Shared password strength check — used by RegisterRequest, PasswordChangeRequest,
    and PasswordResetConfirm. Raises ValueError with the same messages as before
    if any check fails.
    """
    # must be all true to pass
    checks: dict[str, bool] = {"length": False, "upper": False, "lower": False, "number": False, "symbol": False, "valid": True}
    if len(password) >= 8:
        checks["length"] = True

    for c in password:
        value = ord(c)
        if not checks["number"] and c.isdigit():
            checks["number"] = True
            continue
        if not checks["upper"] and c.isupper():
            checks["upper"] = True
            continue
        if not checks["lower"] and c.islower():
            checks["lower"] = True
            continue
        if not checks["symbol"] and (33 <= value <= 47 or 58 <= value <= 64 or 91 <= value <= 96 or 123 <= value <= 126):
            checks["symbol"] = True
            continue
        if value <= 32 or value >= 127:
            checks["valid"] = False

    if any(not value for value in checks.values()):
        msg = ""
        for key, value in checks.items():
            if not value:
                msg += PASSWORD_ERROR_MSG[key]

        raise ValueError(msg)

    return password


class RegisterRequest(BaseModel):
    email: EmailStr
    phone: str
    password: str
    first_name: str
    last_name: str
    # role is intentionally excluded — all publicly registered users are "user".

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, phone: str) -> str:
        return _normalize_phone(phone)

    @field_validator("password")
    @classmethod
    def check_password(cls, password: str) -> str:
        return validate_password_strength(password)


class AdminRegisterRequest(BaseModel):
    email: EmailStr
    # phone excluded b/c user will set themselves when they make their own account
    # password is excluded because when user logs into their new account they will make one themselves
    first_name: str
    last_name: str
    role: Literal["admin", "user"]


class MessageResponse(BaseModel):
    detail: str


# ---------------------------------------------------------------------------
# Account settings — email change, password change, password reset
# ---------------------------------------------------------------------------

class EmailChangeRequest(BaseModel):
    """POST /auth/email/request-change — authenticated."""
    new_email: EmailStr


class EmailPendingChangeResponse(BaseModel):
    """
    GET /auth/email/pending-change — authenticated.
    Also the response shape for POST /auth/email/request-change.

    Both fields null together means no email change is currently pending.
    """
    new_email: Optional[str] = None
    can_resend_at: Optional[datetime] = None


class PasswordChangeRequest(BaseModel):
    """POST /auth/password/change — authenticated."""
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def check_new_password(cls, password: str) -> str:
        return validate_password_strength(password)

    @model_validator(mode="after")
    def check_new_differs_from_current(self) -> "PasswordChangeRequest":
        if self.current_password == self.new_password:
            raise ValueError("New password must be different from current password.")
        return self


class PasswordResetRequest(BaseModel):
    """POST /auth/password/reset/request — logged out, by email."""
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    """POST /auth/password/reset/confirm — logged out, token + new password."""
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def check_new_password(cls, password: str) -> str:
        return validate_password_strength(password)
    
class AccountSetupConfirm(BaseModel):
    """
    POST /auth/account-setup/confirm — logged out.

    Consumes an 'account_setup' token (sent when an admin creates a user) and
    completes the account: sets the initial password, collects phone (not
    gathered at invite-time), and optionally lets the user correct the name
    the admin entered. Mirrors sign-up's phase-1 fields, minus email (locked
    to the invited address) and plus optional name correction.

    Does NOT set email_verified — that still requires the normal verification flow.
    """
    token: str
    password: str
    phone: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
 
    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, phone: str) -> str:
        return _normalize_phone(phone)
 
    @field_validator("password")
    @classmethod
    def check_password(cls, password: str) -> str:
        return validate_password_strength(password)
 
 
class AccountSetupResendRequest(BaseModel):
    """
    POST /admin/auth/account-setup/resend — admin only.

    Resends the account-setup invite for a specific user (by id) at the
    admin's request. Not public — avoids any account-enumeration surface
    on the signup page.
    """
    user_id: int


# ---------------------------------------------------------------------------
# Self-service deactivate / delete
# ---------------------------------------------------------------------------

class AccountDeactivateRequest(BaseModel):
    """
    POST /users/me/deactivate — authenticated.
    
    Reversible — sets status="deactivated" and revokes every session.
    """
    password: str


class AccountDeleteRequest(BaseModel):
    """
    DELETE /users/me — authenticated.
    
    Irreversible hard delete — cascades through TournamentMembership and
    everything else owned by the user.
    """
    password: str