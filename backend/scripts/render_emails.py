"""Temporary preview of every email template. Not part of the app.

From backend/:

    python scripts/render_emails.py

Calls the real send functions in email_service, so template and constant
changes there show up here. Nothing is sent: the SES call is intercepted
after _send has finished building the message.

Writes HTML files to backend/tmp_emails/. Open index.html in a browser.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.services import email_service

OUT = Path(__file__).resolve().parents[1] / "tmp_emails"
TO = "volunteer@example.com"
NEW = "new-address@example.com"
OLD = "current-address@example.com"
TOKEN = "placeholder-token"
TOURNAMENT = "2026 SoCal Invitational"
JOIN = "https://nexus.example/join?code=ABC123"

captured: list[tuple[str, str, str, str]] = []


async def _capture_ses_call(fn, /, *args, **kwargs) -> None:
    content = kwargs["Content"]["Simple"]
    captured.append((
        kwargs["Destination"]["ToAddresses"][0],
        content["Subject"]["Data"],
        content["Body"]["Text"]["Data"],
        content["Body"]["Html"]["Data"],
    ))


def _token(*_args, **_kwargs) -> str:
    return TOKEN


async def main() -> None:
    # _send returns before SES when AWS keys are blank. Fill them so the real
    # function runs through to the send call, which is what we capture.
    settings = get_settings()
    if not (settings.aws_access_key_id and settings.aws_secret_access_key):
        settings.aws_access_key_id = "preview"
        settings.aws_secret_access_key = "preview"
    settings.ses_max_send_rate = 1000

    email_service.asyncio.to_thread = _capture_ses_call
    email_service.create_verification_token = _token

    await email_service.send_verification_email(TO, TOKEN)
    await email_service.send_email_change_email(NEW, TOKEN)
    await email_service.send_email_change_requested_notice(None, 1, OLD, NEW)
    await email_service.send_password_reset_email(TO, TOKEN)
    await email_service.send_password_changed_notice(TO)
    await email_service.send_account_setup_email(TO, TOKEN)
    await email_service.send_staff_invite_email(TO, TOURNAMENT, JOIN)

    OUT.mkdir(exist_ok=True)
    (OUT / ".gitignore").write_text("*\n", encoding="utf-8")
    cards = []
    for i, (to, subject, text, html) in enumerate(captured, start=1):
        slug = f"{i:02d}"
        (OUT / f"{slug}.html").write_text(html, encoding="utf-8")
        (OUT / f"{slug}.txt").write_text(f"To: {to}\nSubject: {subject}\n\n{text}", encoding="utf-8")
        cards.append(
            f"<section><h2>{subject}</h2><p>To: {to}</p>"
            f'<iframe src="{slug}.html" title="{subject}"></iframe>'
            f"<details><summary>Plain text</summary><pre>{_escape(text)}</pre></details></section>"
        )

    (OUT / "index.html").write_text(
        """<!DOCTYPE html><html><head><meta charset="utf-8"><title>NEXUS emails</title>
<style>
  body { margin: 0; background: #f7f7f5; font-family: system-ui, sans-serif; color: #0a0a0a; }
  main { max-width: 640px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 22px; }
  section { margin: 40px 0; }
  iframe { width: 100%; height: 720px; border: 1px solid #e2e2de; border-radius: 10px; background: white; }
  pre { white-space: pre-wrap; font-size: 13px; }
</style></head><body><main>
<h1>NEXUS email previews</h1>
<p>Placeholder recipient, token, and links. These were not sent.</p>
"""
        + "\n".join(cards)
        + "</main></body></html>",
        encoding="utf-8",
    )
    print(f"Wrote {len(captured)} emails to {OUT / 'index.html'}")


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


if __name__ == "__main__":
    asyncio.run(main())
