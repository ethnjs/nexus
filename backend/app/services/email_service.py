import resend

from app.core.config import get_settings


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