import asyncio
import logging
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from html import escape
from typing import Concatenate

import resend
from fastapi import BackgroundTasks
from resend.exceptions import RateLimitError

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


class _Bold(str):
    """Template text rendered in bold. Markup is a type, not syntax inside the
    string, so a value such as a tournament name can never trigger it."""


# A paragraph is one string, or segments joined with spaces.
type _Paragraph = str | tuple[str, ...]


@dataclass
class _Email:
    subject: str
    heading: str
    paragraphs: list[_Paragraph]
    footnote: str
    cta_label: str | None = None
    cta_url: str | None = None
    code: str | None = None


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


_SUPPORT_EMAIL = "support@nexus.socalscioly.org"
_SUPPORT_LINE = f"Questions? Email {_SUPPORT_EMAIL}"
_ORG_LINE = "Southern California Science Olympiad, a California 501(c)(3) non-profit"
_CONTACT_SUPPORT = "If this wasn't you, please contact support."


def _segments(paragraph: _Paragraph) -> tuple[str, ...]:
    return paragraph if isinstance(paragraph, tuple) else (paragraph,)


def _paragraph_html(paragraph: _Paragraph) -> str:
    return " ".join(
        f"<b>{escape(segment)}</b>" if isinstance(segment, _Bold) else escape(segment)
        for segment in _segments(paragraph)
    )


def _with_support_link(text: str) -> str:
    """Escapes footer text and links the support address. Only for template text."""
    link = f'<a href="mailto:{_SUPPORT_EMAIL}" style="color:{_COLOR_TEXT_SECONDARY};">{_SUPPORT_EMAIL}</a>'
    return escape(text).replace(_SUPPORT_EMAIL, link)


def _render_text(email: _Email) -> str:
    return "\n\n".join(
        [
            email.heading,
            *(" ".join(_segments(paragraph)) for paragraph in email.paragraphs),
            *([f"Your code: {email.code}"] if email.code else []),
            *([f"{email.cta_label}: {email.cta_url}"] if email.cta_url else []),
            email.footnote,
            f"{_SUPPORT_LINE}\n{_ORG_LINE}",
        ]
    )


def _action_html(email: _Email) -> str:
    """The code block for code emails, else the button and its fallback link."""
    if email.code:
        return f"""<p style="margin:24px 0 8px 0;padding:16px 0 16px 0.3em;font-size:32px;font-weight:600;letter-spacing:0.3em;color:{_COLOR_TEXT_PRIMARY};background-color:{_COLOR_BG};border:1px solid {_COLOR_BORDER};border-radius:6px;font-family:{_FONT_SANS};text-align:center;">{escape(email.code)}</p>"""
    assert email.cta_label is not None and email.cta_url is not None
    url = escape(email.cta_url)
    return f"""<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px auto;">
                  <tr>
                    <td style="border-radius:6px;background-color:{_COLOR_ACCENT};border:1px solid {_COLOR_ACCENT};">
                      <a href="{url}" style="display:inline-block;padding:16px 20px;font-size:15px;font-weight:600;letter-spacing:0.01em;color:{_COLOR_TEXT_INVERSE};text-decoration:none;border-radius:6px;font-family:{_FONT_SANS};">{escape(email.cta_label)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0 0;font-size:12px;line-height:1.5;color:{_COLOR_TEXT_TERTIARY};word-break:break-all;font-family:{_FONT_SANS};text-align:left;">
                  If the button doesn't work, copy and paste this link:<br />
                  <a href="{url}" style="color:{_COLOR_TEXT_SECONDARY};">{url}</a>
                </p>"""


def _render_html(email: _Email) -> str:
    paragraphs = "".join(
        f'<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:{_COLOR_TEXT_SECONDARY};font-family:{_FONT_SANS};text-align:center;">{_paragraph_html(paragraph)}</p>'
        for paragraph in email.paragraphs
    )
    footer = "".join(
        f'<p style="margin:8px 0 0 0;font-size:12px;line-height:1.5;color:{_COLOR_TEXT_TERTIARY};font-family:{_FONT_SANS};">{_with_support_link(line)}</p>'
        for line in (_SUPPORT_LINE, _ORG_LINE)
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
                {_action_html(email)}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 40px 32px 40px;border-top:1px solid {_COLOR_BORDER};text-align:left;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:{_COLOR_TEXT_TERTIARY};font-family:{_FONT_SANS};">{_with_support_link(email.footnote)}</p>
                {footer}
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
# Sending
# ---------------------------------------------------------------------------

# Resend's limit is per second and shared by the whole team, so a staff invite
# batch or concurrent workers can briefly exceed it.
_RATE_LIMIT_ATTEMPTS = 4


def _retry_delay(error: RateLimitError, attempt: int) -> float:
    """Seconds before the next attempt: Resend's retry-after when it sends one,
    else exponential backoff. Jittered so a rejected batch doesn't retry in lockstep."""
    retry_after = next(
        (value for key, value in error.headers.items() if key.lower() == "retry-after"), None
    )
    try:
        base = float(retry_after) if retry_after is not None else 2 ** (attempt - 1)
    except ValueError:
        base = 2 ** (attempt - 1)
    return min(base, 10) + random.uniform(0, 1)


def _log_email(reason: str, to: str, subject: str, text: str) -> None:
    logger.warning(
        "\n%s\nTo:      %s\nSubject: %s\n\n%s\n%s",
        f"-- Email not sent: {reason} ".ljust(72, "-"),
        to,
        subject,
        text,
        "-" * 72,
    )


async def _send(to: str, subject: str, text: str, html: str) -> None:
    """Sends through Resend, retrying rate-limited attempts. Outside production, mail to
    @nexus.dev is logged in full instead. Without an API key (never the case in production,
    which Settings refuses to start) it logs instead of sending."""
    settings = get_settings()

    # Seeded and scripted accounts use @nexus.dev, a real domain someone else owns.
    if settings.app_env != "production" and to.lower().endswith("@nexus.dev"):
        _log_email("@nexus.dev outside production", to, subject, text)
        return

    if not settings.resend_api_key:
        if settings.app_env == "development":
            _log_email("RESEND_API_KEY not set", to, subject, text)
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

    for attempt in range(1, _RATE_LIMIT_ATTEMPTS + 1):
        try:
            await resend.Emails.send_async(params)
            return
        except RateLimitError as e:
            # Quota errors share the 429 status but won't clear within seconds.
            if e.error_type != "rate_limit_exceeded" or attempt == _RATE_LIMIT_ATTEMPTS:
                raise
            await asyncio.sleep(_retry_delay(e, attempt))


async def _send_email(to: str, email: _Email) -> None:
    await _send(to, email.subject, _render_text(email), _render_html(email))


def send_in_background[**P](
    background_tasks: BackgroundTasks,
    send: Callable[Concatenate[str, P], Awaitable[None]],
    to: str,
    *args: P.args,
    **kwargs: P.kwargs,
) -> None:
    """Runs `send(to, ...)` after the response goes out, logging any failure, since no caller is left to see it."""

    async def send_and_log() -> None:
        try:
            await send(to, *args, **kwargs)
        except Exception:
            name = getattr(send, "__name__", send)
            logger.exception("Background email failed: %s to %s", name, to)

    background_tasks.add_task(send_and_log)


# ---------------------------------------------------------------------------
# Account emails
# ---------------------------------------------------------------------------


async def send_sign_in_code_email(to: str, code: str) -> None:
    await _send_email(
        to,
        _Email(
            subject="Your NEXUS sign-in code",
            heading="Your sign-in code",
            paragraphs=["Enter this code to finish signing in to NEXUS."],
            code=code,
            footnote="This code expires in 10 minutes. If you didn't try to sign in, someone may know your password, so change it.",
        ),
    )


async def send_sign_up_code_email(to: str, code: str) -> None:
    await _send_email(
        to,
        _Email(
            subject="Verify your email on NEXUS",
            heading="Verify your email",
            paragraphs=[
                "Thanks for signing up for NEXUS. Enter this code to confirm your email address and create your account.",
            ],
            code=code,
            footnote="This code expires in 10 minutes. If you didn't sign up for NEXUS, you can ignore this email.",
        ),
    )


async def send_step_up_code_email(to: str, code: str) -> None:
    await _send_email(
        to,
        _Email(
            subject="Confirm it's you on NEXUS",
            heading="Confirm it's you",
            paragraphs=["Enter this code in NEXUS to continue with the change you're making."],
            code=code,
            footnote="This code expires in 10 minutes. If you didn't request it, someone may be signed in to your account: change your password and contact support.",
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
                (
                    _Bold("If you made this request, no action is needed."),
                    "You can safely ignore this email.",
                ),
                "If this wasn't you, please secure your account below.",
            ],
            cta_label="Secure your account",
            cta_url=_cta_url("/revert-email-change", revert_token),
            footnote=f"This link expires in 24 hours. {_CONTACT_SUPPORT}",
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
            footnote=f"This link expires in 1 hour. {_CONTACT_SUPPORT}",
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
                (
                    _Bold("If you made this change, no action is needed."),
                    "You can safely ignore this email.",
                ),
                "If this wasn't you, please secure your account below.",
            ],
            cta_label="Secure your account",
            cta_url=_cta_url("/forgot-password"),
            footnote=_CONTACT_SUPPORT,
        ),
    )


async def send_account_setup_email(to: str, token: str) -> None:
    """No caller yet: kept for the dormant /auth/account-setup/confirm/ flow's future invite producer."""
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
            footnote=f"If you weren't expecting this, you can ignore this email, or email {_SUPPORT_EMAIL} to stop receiving invites.",
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
