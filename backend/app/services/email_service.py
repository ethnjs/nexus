import resend
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.auth import create_verification_token, RateLimitedError


async def send_verification_email(to: str, token: str) -> None:
    settings = get_settings()
    resend.api_key = settings.resend_api_key
    
    params: resend.Emails.SendParams = {
        "from": "NEXUS <verify@nexus.ethanshih.com>",
        "to": to,
        "subject": "Verify Your Email on NEXUS",
        "text": f"Please verify your email: {settings.frontend_url.rstrip('/')}/verify-email?token={token}"
    }

    await resend.Emails.send_async(params)


async def send_signup_verification_email(db: Session, to: str, user_id: int) -> None:
    try:
        token = create_verification_token(db, user_id, "signup_verify")
    except RateLimitedError as e:
        raise HTTPException(429, str(e))

    try:
        await send_verification_email(to, token)
    except Exception:
        raise HTTPException(500, "Failed to send verification email")