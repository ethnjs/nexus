import asyncio
import logging
import time
from functools import lru_cache

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.auth import RateLimitedError, create_verification_token
from app.core.config import get_settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared HTML template
#
# Colors and fonts mirror frontend/app/globals.css. Styling stays inline because
# email clients strip <style> blocks unpredictably; only @font-face lives there.
# ---------------------------------------------------------------------------

_COLOR_BG = "#F7F7F5"
_COLOR_SURFACE = "#FFFFFF"
_COLOR_BORDER = "#E2E2DE"
_COLOR_TEXT_PRIMARY = "#0A0A0A"
_COLOR_TEXT_SECONDARY = "#6B6B65"
_COLOR_TEXT_TERTIARY = "#9B9B93"
_COLOR_TEXT_INVERSE = "#FFFFFF"
_COLOR_ACCENT = "#0A0A0A"
_COLOR_ACCENT_HOVER = "#2A2A2A"

_FONT_SERIF = "Georgia, serif"
_FONT_SANS = "'Geist', system-ui, sans-serif"
_FONT_MONO = "'Geist Mono', 'Courier New', monospace"

_SUPPORT_EMAIL = "support@nexus.socalscioly.org"
_SUPPORT_LINK = (
    f'<a href="mailto:{_SUPPORT_EMAIL}" style="color:{_COLOR_TEXT_SECONDARY};">{_SUPPORT_EMAIL}</a>'
)
_ORG_LINE = "Southern California Science Olympiad, a California 501(c)(3) non-profit"
_CONTACT_SUPPORT = "If this wasn't you, please contact support."


_FONT_FACES = """\
  <style>
    @font-face {
      font-family: 'Geist';
      src: url('https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/Geist-Regular.woff2') format('woff2');
      font-weight: 400;
    }
    @font-face {
      font-family: 'Geist';
      src: url('https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/Geist-SemiBold.woff2') format('woff2');
      font-weight: 600;
    }
    @font-face {
      font-family: 'Geist Mono';
      src: url('https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-mono/GeistMono-Regular.woff2') format('woff2');
      font-weight: 400;
    }
  </style>
"""


def _render_email_html(
    heading: str,
    body_lines: list[str],
    footnote: str,
    cta_label: str | None = None,
    cta_url: str | None = None,
) -> str:
    body_html = "".join(
        f'<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:{_COLOR_TEXT_SECONDARY};font-family:{_FONT_SANS};text-align:center;">{line}</p>'
        for line in body_lines
    )

    cta_block = ""
    if cta_url and cta_label:
        cta_block = f"""\
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px auto;">
                  <tr>
                    <td style="border-radius:6px;background-color:#0A0A0A;border:1px solid #0A0A0A;">
                      <a href="{cta_url}" style="display:inline-block;padding:16px 20px;font-size:15px;font-weight:600;letter-spacing:0.01em;color:#FFFFFF;text-decoration:none;border-radius:6px;font-family:{_FONT_SANS};">{cta_label}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0 0;font-size:12px;line-height:1.5;color:{_COLOR_TEXT_TERTIARY};word-break:break-all;font-family:{_FONT_SANS};text-align:left;">
                  If the button doesn't work, copy and paste this link:<br />
                  <a href="{cta_url}" style="color:{_COLOR_TEXT_SECONDARY};">{cta_url}</a>
                </p>
"""

    return f"""\
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
{_FONT_FACES}  </head>
  <body style="margin:0;padding:0;background-color:{_COLOR_BG};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{_COLOR_BG};padding:40px 20px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:{_COLOR_SURFACE};border:1px solid {_COLOR_BORDER};border-radius:10px;overflow:hidden;">
            <tr>
              <td style="padding:32px 40px 0 40px;text-align:center;">
                <p style="margin:0;font-size:28px;color:{_COLOR_TEXT_PRIMARY};font-family:{_FONT_SERIF};letter-spacing:-0.02em;">NEXUS</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 40px 24px 40px;text-align:center;">
                <h1 style="margin:0 0 20px 0;font-size:22px;line-height:1.3;color:{_COLOR_TEXT_PRIMARY};font-weight:700;font-family:{_FONT_SANS};">{heading}</h1>
                {body_html}
{cta_block}              </td>
            </tr>
            <tr>
              <td style="padding:20px 40px 32px 40px;border-top:1px solid {_COLOR_BORDER};text-align:left;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:{_COLOR_TEXT_TERTIARY};font-family:{_FONT_SANS};">{footnote}</p>
                <p style="margin:8px 0 0 0;font-size:12px;line-height:1.5;color:{_COLOR_TEXT_TERTIARY};font-family:{_FONT_SANS};">Questions? Email <a href="mailto:{_SUPPORT_EMAIL}" style="color:{_COLOR_TEXT_SECONDARY};">{_SUPPORT_EMAIL}</a></p>
                <p style="margin:8px 0 0 0;font-size:12px;line-height:1.5;color:{_COLOR_TEXT_TERTIARY};font-family:{_FONT_SANS};">{_ORG_LINE}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def _cta_url(path: str, token: str | None = None) -> str:
    settings = get_settings()
    base = f"{settings.frontend_url.rstrip('/')}{path}"
    return f"{base}?token={token}" if token else base


# ---------------------------------------------------------------------------
# Sending (Amazon SES v2)
# ---------------------------------------------------------------------------


@lru_cache
def _get_ses_client(
    access_key_id: str, secret_access_key: str, region: str, max_attempts: int
) -> BaseClient:
    # A dedicated Session because the default one isn't thread-safe; the client is,
    # and it's shared across asyncio.to_thread workers.
    session = boto3.session.Session(
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name=region,
    )
    return session.client(
        "sesv2",
        # boto3's default "legacy" mode doesn't retry SES v2's TooManyRequestsException.
        config=Config(retries={"mode": "standard", "total_max_attempts": max_attempts}),
    )


class _SendRateLimiter:
    """Spaces sends `interval` seconds apart to stay under SES's per-second quota.

    Pacing is per process: with N uvicorn workers or replicas, set SES_MAX_SEND_RATE to quota / N.
    """

    def __init__(self) -> None:
        self._next_slot = 0.0

    async def wait(self, interval: float) -> None:
        # No lock needed: nothing is awaited between reading and advancing _next_slot.
        now = time.monotonic()
        slot = max(now, self._next_slot)
        self._next_slot = slot + interval
        if slot > now:
            await asyncio.sleep(slot - now)


_rate_limiter = _SendRateLimiter()


async def _send(to: str, subject: str, text: str, html: str) -> None:
    """Sends through SES. Without AWS keys it logs and skips, except in production, where it raises."""
    text = f"{text}\n\nQuestions? Email {_SUPPORT_EMAIL}\n{_ORG_LINE}"
    settings = get_settings()

    if not (settings.aws_access_key_id and settings.aws_secret_access_key):
        if settings.app_env == "production":
            raise RuntimeError(
                "SES is not configured: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set"
            )
        if settings.app_env == "development":
            logger.warning(
                "%s\nTo:      %s\nSubject: %s\n\n%s\n%s",
                "-- Email not sent: SES not configured ".ljust(72, "-"),
                to,
                subject,
                text,
                "-" * 72,
            )
        else:
            logger.warning("SES not configured, skipping email to %s: %s", to, subject)
        return

    client = _get_ses_client(
        settings.aws_access_key_id,
        settings.aws_secret_access_key,
        settings.aws_region,
        settings.ses_max_attempts,
    )
    await _rate_limiter.wait(1 / settings.ses_max_send_rate)
    await asyncio.to_thread(
        client.send_email,
        FromEmailAddress=settings.email_from_address,
        Destination={"ToAddresses": [to]},
        Content={
            "Simple": {
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": text, "Charset": "UTF-8"},
                    "Html": {"Data": html, "Charset": "UTF-8"},
                },
            },
        },
    )


# ---------------------------------------------------------------------------
# Signup verification
# ---------------------------------------------------------------------------


async def send_verification_email(to: str, token: str) -> None:
    url = _cta_url("/verify-email", token)
    html = _render_email_html(
        heading="Verify your email",
        body_lines=[
            "Thanks for signing up for NEXUS. Confirm this is your email address to finish setting up your account.",
        ],
        cta_label="Verify email",
        cta_url=url,
        footnote=f"This link expires in 24 hours. {_CONTACT_SUPPORT}",
    )
    await _send(to, "Verify your email on NEXUS", f"Please verify your email: {url}", html)


async def send_signup_verification_email(db: Session, to: str, user_id: int) -> None:
    try:
        token = create_verification_token(db, user_id, "signup_verify")
    except RateLimitedError as e:
        raise HTTPException(429, str(e)) from e

    try:
        await send_verification_email(to, token)
    except Exception as e:
        raise HTTPException(500, "Failed to send verification email") from e


# ---------------------------------------------------------------------------
# Email change
# ---------------------------------------------------------------------------


async def send_email_change_email(to_new_email: str, token: str) -> None:
    url = _cta_url("/confirm-email-change", token)
    html = _render_email_html(
        heading="Confirm your new email",
        body_lines=[
            "You requested to change the email address on your NEXUS account to this address.",
            "Confirm the change below. Your current email stays active until you do.",
        ],
        cta_label="Confirm new email",
        cta_url=url,
        footnote="This link expires in 24 hours. If you didn't request this change, please contact support.",
    )
    await _send(
        to_new_email, "Confirm your new email on NEXUS", f"Confirm your new email: {url}", html
    )


async def send_email_change_request_email(db: Session, user_id: int, new_email: str) -> None:
    try:
        token = create_verification_token(db, user_id, "email_change", new_email=new_email)
    except RateLimitedError as e:
        raise HTTPException(429, str(e)) from e

    try:
        await send_email_change_email(new_email, token)
    except Exception as e:
        raise HTTPException(500, "Failed to send email change confirmation") from e


async def send_email_change_requested_notice(
    db: Session, user_id: int, old_email: str, new_email: str
) -> None:
    """Warns the old address when a change is requested, while it can still be stopped.

    Creates an email_change_revert token for the link, since after the change the owner can't
    recover through /forgot-password with an address they no longer control.
    """
    try:
        revert_token = create_verification_token(
            db, user_id, "email_change_revert", new_email=old_email
        )
    except RateLimitedError as e:
        raise HTTPException(429, str(e)) from e

    url = _cta_url("/revert-email-change", revert_token)
    html = _render_email_html(
        heading="Your email address is being changed",
        body_lines=[
            f"A request was made to change the email on your NEXUS account to {new_email}.",
            "<b>If you made this request, no action is needed.</b> You can safely ignore this email.",
            "If this wasn't you, please secure your account below.",
        ],
        cta_label="Secure your account",
        cta_url=url,
        footnote=_CONTACT_SUPPORT,
    )
    await _send(
        old_email,
        "Your NEXUS account email is being changed",
        f"A request was made to change your account email to {new_email}. If this wasn't you, secure your account: {url}",
        html,
    )


# ---------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------


async def send_password_reset_email(to: str, token: str) -> None:
    url = _cta_url("/reset-password", token)
    html = _render_email_html(
        heading="Reset your password",
        body_lines=[
            "We received a request to reset the password on your NEXUS account.",
            "Choose a new password to regain access.",
        ],
        cta_label="Reset password",
        cta_url=url,
        footnote=f"This link expires in 1 hour. {_CONTACT_SUPPORT}",
    )
    await _send(to, "Reset your password on NEXUS", f"Reset your password: {url}", html)


async def send_password_reset_request_email(db: Session, user_id: int, to: str) -> None:
    try:
        token = create_verification_token(db, user_id, "password_reset")
    except RateLimitedError as e:
        raise HTTPException(429, str(e)) from e

    try:
        await send_password_reset_email(to, token)
    except Exception as e:
        raise HTTPException(500, "Failed to send password reset email") from e


async def send_password_changed_notice(to: str) -> None:
    """Sent after a password change from settings, not after a forgot-password reset."""
    url = _cta_url("/forgot-password")
    html = _render_email_html(
        heading="Your password was changed",
        body_lines=[
            "The password on your NEXUS account was just changed.",
            "<b>If you made this request, no action is needed.</b> You can safely ignore this email.",
            "If this wasn't you, please secure your account below.",
        ],
        cta_label="Secure your account",
        cta_url=url,
        footnote=_CONTACT_SUPPORT,
    )
    await _send(
        to,
        "Your NEXUS password was changed",
        f"Your password was just changed. If this wasn't you, reset it here: {url}",
        html,
    )


# ---------------------------------------------------------------------------
# Account setup (admin-created invite)
# ---------------------------------------------------------------------------


async def send_account_setup_email(to: str, token: str) -> None:
    url = _cta_url("/account-setup", token)
    html = _render_email_html(
        heading="You've been added to NEXUS",
        body_lines=[
            "An administrator created an account for you on NEXUS.",
            "Set up your account to get started.",
        ],
        cta_label="Set up account",
        cta_url=url,
        footnote="This link expires in 7 days. If you weren't expecting this, contact support.",
    )
    await _send(to, "You've been added to NEXUS", f"Set up your account: {url}", html)


async def send_account_setup_invite_email(db: Session, user_id: int, to: str) -> None:
    try:
        token = create_verification_token(db, user_id, "account_setup")
    except RateLimitedError as e:
        raise HTTPException(429, str(e)) from e

    try:
        await send_account_setup_email(to, token)
    except Exception as e:
        raise HTTPException(500, "Failed to send account setup email") from e


# ---------------------------------------------------------------------------
# Tournament staff invite
# ---------------------------------------------------------------------------


async def send_staff_invite_email(to: str, tournament_name: str, join_url: str) -> None:
    html = _render_email_html(
        heading=f"You're invited to help run {tournament_name}",
        body_lines=[
            f"You've been invited to join the staff for {tournament_name} on NEXUS.",
            "Use the link below to join.",
        ],
        cta_label="Join tournament",
        cta_url=join_url,
        footnote=f"If you weren't expecting this, you can ignore this email, or email {_SUPPORT_LINK} to stop receiving invites.",
    )
    text = (
        f"Join {tournament_name}: {join_url}\n\n"
        f"If you weren't expecting this, you can ignore this email, or email {_SUPPORT_EMAIL} to stop receiving invites."
    )
    await _send(to, f"You're invited to help run {tournament_name}", text, html)


async def send_staff_invite_emails(
    to_emails: list[str], tournament_name: str, join_url: str
) -> list[str]:
    """Sends one invite per address (not BCC) and returns the addresses that failed."""
    results = await asyncio.gather(
        *(send_staff_invite_email(email, tournament_name, join_url) for email in to_emails),
        return_exceptions=True,
    )
    return [
        email
        for email, result in zip(to_emails, results, strict=True)
        if isinstance(result, Exception)
    ]
