import resend
from fastapi import HTTPException

from app.core.config import get_settings
from app.core.email_verification import generate_verification_token


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


async def send_signup_verification_email(to: str, user_id: int) -> None:
    """
    Sends the signup verification email. Currently still JWT-based via
    app.core.email_verification — pending migration to the shared
    verification_tokens flow.
    """
    try:
        await send_verification_email(to, generate_verification_token(user_id))
    except Exception:
        raise HTTPException(500, "Failed to send verification email")