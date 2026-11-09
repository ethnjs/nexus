import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from html import escape

import resend
from fastapi import BackgroundTasks

from app.core.config import get_settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Content and rendering
#
# Each sender describes its email as an _Email, and both the HTML and the
# plain-text version are built from it, with every value escaped. Colors and
# fonts mirror frontend/app/globals.css. Styling stays inline because email
# clients strip <style> blocks unpredictably; only @font-face lives there.
# ---------------------------------------------------------------------------


@dataclass
class _Email:
    subject: str
    heading: str
    paragraphs: list[str]
    cta_label: str
    cta_url: str
    footnote: str


_COLOR_BG = "#F7F7F5"
_COLOR_SURFACE = "#FFFFFF"
_COLOR_BORDER = "#E2E2DE"
_COLOR_TEXT_PRIMARY = "#0A0A0A"
_COLOR_TEXT_SECONDARY = "#6B6B65"
_COLOR_TEXT_TERTIARY = "#9B9B93"
_COLOR_TEXT_INVERSE = "#FFFFFF"
_COLOR_ACCENT = "#0A0A0A"

_FONT_SERIF = "Georgia, serif"
_FONT_SANS = "'Geist', system-ui, sans-serif"

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
  </style>
"""


def _render_text(email: _Email) -> str:
    return "\n\n".join(
        [
            email.heading,
            *email.paragraphs,
            f"{email.cta_label}: {email.cta_url}",
            email.footnote,
        ]
    )


def _render_html(email: _Email) -> str:
    url = escape(email.cta_url)
    paragraphs = "".join(
        f'<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:{_COLOR_TEXT_SECONDARY};font-family:{_FONT_SANS};text-align:center;">{escape(paragraph)}</p>'
        for paragraph in email.paragraphs
    )

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
                <h1 style="margin:0 0 20px 0;font-size:22px;line-height:1.3;color:{_COLOR_TEXT_PRIMARY};font-weight:700;font-family:{_FONT_SANS};">{escape(email.heading)}</h1>
                {paragraphs}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px auto;">
                  <tr>
                    <td style="border-radius:6px;background-color:{_COLOR_ACCENT};border:1px solid {_COLOR_ACCENT};">
                      <a href="{url}" style="display:inline-block;padding:16px 20px;font-size:15px;font-weight:600;letter-spacing:0.01em;color:{_COLOR_TEXT_INVERSE};text-decoration:none;border-radius:6px;font-family:{_FONT_SANS};">{escape(email.cta_label)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0 0;font-size:12px;line-height:1.5;color:{_COLOR_TEXT_TERTIARY};word-break:break-all;font-family:{_FONT_SANS};text-align:left;">
                  If the button doesn't work, copy and paste this link:<br />
                  <a href="{url}" style="color:{_COLOR_TEXT_SECONDARY};">{url}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 40px 32px 40px;border-top:1px solid {_COLOR_BORDER};text-align:left;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:{_COLOR_TEXT_TERTIARY};font-family:{_FONT_SANS};">{escape(email.footnote)}</p>
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


_CONTACT_SUPPORT = "If this wasn't you, please contact support."


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------


async def _send(to: str, subject: str, text: str, html: str) -> None:
    """Sends through Resend. Without an API key it logs and skips, except in production, where it raises."""
    settings = get_settings()

    if not settings.resend_api_key:
        if settings.app_env == "production":
            raise RuntimeError("Email is not configured: RESEND_API_KEY must be set")
        if settings.app_env == "development":
            logger.warning(
                "%s\nTo:      %s\nSubject: %s\n\n%s\n%s",
                "-- Email not sent: RESEND_API_KEY not set ".ljust(72, "-"),
                to,
                subject,
                text,
                "-" * 72,
            )
        else:
            # Preview logs are shared, so the body (with its tokens) stays out of them.
            logger.warning("RESEND_API_KEY not set, skipping email to %s: %s", to, subject)
        return

    resend.api_key = settings.resend_api_key

    params: resend.Emails.SendParams = {
        "from": "NEXUS <verify@nexus.socalscioly.org>",
        "to": to,
        "subject": subject,
        "text": text,
        "html": html,
    }

    await resend.Emails.send_async(params)


async def _send_email(to: str, email: _Email) -> None:
    await _send(to, email.subject, _render_text(email), _render_html(email))


def send_in_background[**P](
    background_tasks: BackgroundTasks,
    send: Callable[P, Awaitable[None]],
    *args: P.args,
    **kwargs: P.kwargs,
) -> None:
    """Runs `send` after the response goes out, logging any failure, since no caller is left to see it."""

    async def send_and_log() -> None:
        try:
            await send(*args, **kwargs)
        except Exception:
            logger.exception("Background email failed: %s", getattr(send, "__name__", send))

    background_tasks.add_task(send_and_log)


# ---------------------------------------------------------------------------
# Account emails
# ---------------------------------------------------------------------------


async def send_verification_email(to: str, token: str) -> None:
    await _send_email(
        to,
        _Email(
            subject="Verify your email on NEXUS",
            heading="Verify your email",
            paragraphs=[
                "Thanks for signing up for NEXUS. Confirm this is your email address to finish setting up your account.",
            ],
            cta_label="Verify email",
            cta_url=_cta_url("/verify-email", token),
            footnote="This link expires in 24 hours. If you didn't create this account, please contact support right away.",
        ),
    )


async def send_email_change_email(to_new_email: str, token: str) -> None:
    await _send_email(
        to_new_email,
        _Email(
            subject="Confirm your new email on NEXUS",
            heading="Confirm your new email",
            paragraphs=[
                "You requested to change the email address on your NEXUS account to this address.",
                "Confirm the change below. Your current email stays active until you do.",
            ],
            cta_label="Confirm new email",
            cta_url=_cta_url("/confirm-email-change", token),
            footnote="This link expires in 24 hours. If you didn't request this change, please contact support.",
        ),
    )


async def send_email_change_requested_notice(
    old_email: str, new_email: str, revert_token: str
) -> None:
    await _send_email(
        old_email,
        _Email(
            subject="Your NEXUS account email is being changed",
            heading="Your email address is being changed",
            paragraphs=[
                f"A request was made to change the email on your NEXUS account to {new_email}.",
                "If you made this request, no action is needed.",
            ],
            cta_label="Secure your account",
            cta_url=_cta_url("/revert-email-change", revert_token),
            footnote=_CONTACT_SUPPORT,
        ),
    )


async def send_password_reset_email(to: str, token: str) -> None:
    await _send_email(
        to,
        _Email(
            subject="Reset your password on NEXUS",
            heading="Reset your password",
            paragraphs=[
                "We received a request to reset the password on your NEXUS account.",
                "Choose a new password to regain access.",
            ],
            cta_label="Reset password",
            cta_url=_cta_url("/reset-password", token),
            footnote=f"This link expires in 1 hour. If you didn't request this, someone may be trying to access your account. {_CONTACT_SUPPORT}",
        ),
    )


async def send_password_changed_notice(to: str) -> None:
    await _send_email(
        to,
        _Email(
            subject="Your NEXUS password was changed",
            heading="Your password was changed",
            paragraphs=[
                "The password on your NEXUS account was just changed.",
                "If you made this change, no action is needed.",
            ],
            cta_label="Reset password",
            cta_url=_cta_url("/forgot-password"),
            footnote=_CONTACT_SUPPORT,
        ),
    )


async def send_account_setup_email(to: str, token: str) -> None:
    await _send_email(
        to,
        _Email(
            subject="You've been added to NEXUS",
            heading="You've been added to NEXUS",
            paragraphs=[
                "An administrator created an account for you on NEXUS.",
                "Set up your account to get started.",
            ],
            cta_label="Set up account",
            cta_url=_cta_url("/account-setup", token),
            footnote="This link expires in 7 days. If you weren't expecting this, contact support.",
        ),
    )


# ---------------------------------------------------------------------------
# Tournament staff invite
# ---------------------------------------------------------------------------


async def send_staff_invite_email(to: str, tournament_name: str, join_url: str) -> None:
    await _send_email(
        to,
        _Email(
            subject=f"You're invited to help run {tournament_name}",
            heading=f"You're invited to help run {tournament_name}",
            paragraphs=[
                f"You've been invited to join the staff for {tournament_name} on NEXUS.",
                "Use the link below to join.",
            ],
            cta_label="Join tournament",
            cta_url=join_url,
            footnote="If you weren't expecting this, you can ignore this email.",
        ),
    )


async def send_staff_invite_emails(
    to_emails: list[str], tournament_name: str, join_url: str
) -> list[str]:
    """Sends one invite per address in parallel (not BCC) and returns the addresses that failed."""
    results = await asyncio.gather(
        *(send_staff_invite_email(email, tournament_name, join_url) for email in to_emails),
        return_exceptions=True,
    )
    return [
        email
        for email, result in zip(to_emails, results, strict=True)
        if isinstance(result, Exception)
    ]
