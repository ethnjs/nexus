import asyncio
import resend
from fastapi import HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from app.core.config import get_settings
from app.core.auth import create_verification_token, RateLimitedError


# ---------------------------------------------------------------------------
# Shared HTML template
#
# Mirrors app/globals.css: Georgia for the wordmark/heading (matches h1/h2
# on every frontend page), Geist for UI text/CTA, Geist Mono for body copy.
# Geist fonts are loaded from the same jsdelivr CDN the frontend uses via
# @font-face in <head> — email clients that support web fonts (Apple Mail,
# some webmail) will render them; everything else falls back cleanly to
# system-ui / Courier New, same as the app's own font-family fallback chain.
#
# All layout styling stays inline — email clients strip <style> blocks
# unpredictably, so only the @font-face declarations live in <head>.
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
    cta_label: Optional[str] = None,
    cta_url: Optional[str] = None,
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
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def _cta_url(path: str, token: Optional[str] = None) -> str:
    settings = get_settings()
    base = f"{settings.frontend_url.rstrip('/')}{path}"
    return f"{base}?token={token}" if token else base


_CONTACT_SUPPORT = "If this wasn't you, please contact support."


async def _send(to: str, subject: str, text: str, html: str) -> None:
    settings = get_settings()
    resend.api_key = settings.resend_api_key

    params: resend.Emails.SendParams = {
        "from": "NEXUS <verify@nexus.ethanshih.com>",
        "to": to,
        "subject": subject,
        "text": text,
        "html": html,
    }

    await resend.Emails.send_async(params)


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
        footnote="This link expires in 24 hours. If you didn't create this account, please contact support right away.",
    )
    await _send(to, "Verify your email on NEXUS", f"Please verify your email: {url}", html)


async def send_signup_verification_email(db: Session, to: str, user_id: int) -> None:
    try:
        token = create_verification_token(db, user_id, "signup_verify")
    except RateLimitedError as e:
        raise HTTPException(429, str(e))

    try:
        await send_verification_email(to, token)
    except Exception:
        raise HTTPException(500, "Failed to send verification email")


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
    await _send(to_new_email, "Confirm your new email on NEXUS", f"Confirm your new email: {url}", html)


async def send_email_change_request_email(db: Session, user_id: int, new_email: str) -> None:
    try:
        token = create_verification_token(db, user_id, "email_change", new_email=new_email)
    except RateLimitedError as e:
        raise HTTPException(429, str(e))

    try:
        await send_email_change_email(new_email, token)
    except Exception:
        raise HTTPException(500, "Failed to send email change confirmation")


async def send_email_change_requested_notice(db: Session, user_id: int, old_email: str, new_email: str) -> None:
    """
    Sent to the OLD email address the moment an email change is requested
    (not once it's confirmed) — the account owner may not be the one who
    requested it, so this needs to reach them while the change can still be
    intercepted, not just after it's already applied.

    Creates the email_change_revert token itself and embeds it in the CTA
    link, so the recipient can undo the change directly instead of landing
    on /forgot-password with no way to look themselves up (their email is
    about to become the attacker's address).
    """
    try:
        revert_token = create_verification_token(db, user_id, "email_change_revert", new_email=old_email)
    except RateLimitedError as e:
        raise HTTPException(429, str(e))

    url = _cta_url("/revert-email-change", revert_token)
    html = _render_email_html(
        heading="Your email address is being changed",
        body_lines=[
            f"A request was made to change the email on your NEXUS account to {new_email}.",
            "If you made this request, no action is needed.",
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
        footnote=f"This link expires in 1 hour. If you didn't request this, someone may be trying to access your account. {_CONTACT_SUPPORT}",
    )
    await _send(to, "Reset your password on NEXUS", f"Reset your password: {url}", html)


async def send_password_reset_request_email(db: Session, user_id: int, to: str) -> None:
    try:
        token = create_verification_token(db, user_id, "password_reset")
    except RateLimitedError as e:
        raise HTTPException(429, str(e))

    try:
        await send_password_reset_email(to, token)
    except Exception:
        raise HTTPException(500, "Failed to send password reset email")


async def send_password_changed_notice(to: str) -> None:
    """
    Sent after an authenticated password change (settings page), not the
    forgot-password flow. Confirms the change to the account owner and
    gives them a way back in if it wasn't actually them.
    """
    url = _cta_url("/forgot-password")
    html = _render_email_html(
        heading="Your password was changed",
        body_lines=[
            "The password on your NEXUS account was just changed.",
            "If you made this change, no action is needed.",
        ],
        cta_label="Reset password",
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
        raise HTTPException(429, str(e))

    try:
        await send_account_setup_email(to, token)
    except Exception:
        raise HTTPException(500, "Failed to send account setup email")


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
        footnote="If you weren't expecting this, you can ignore this email.",
    )
    await _send(to, f"You're invited to help run {tournament_name}", f"Join {tournament_name}: {join_url}", html)


async def send_staff_invite_emails(to_emails: list[str], tournament_name: str, join_url: str) -> list[str]:
    """
    Sends one personalized invite email per address, in parallel — not BCC,
    which counts every recipient against quota anyway and has worse
    deliverability for this use case. Each send is independent, so one bad
    address doesn't block the rest.

    Returns the subset of to_emails that failed to send.
    """
    results = await asyncio.gather(
        *(send_staff_invite_email(email, tournament_name, join_url) for email in to_emails),
        return_exceptions=True,
    )
    return [email for email, result in zip(to_emails, results) if isinstance(result, Exception)]