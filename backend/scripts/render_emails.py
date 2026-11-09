"""Write every email to tmp_emails/ for previewing in a browser. Nothing is sent.

    uv run python -m scripts.render_emails

Run from backend/. See docs/email-previews.md.
"""

import asyncio
from html import escape
from pathlib import Path
from unittest.mock import patch

from app.core.config import get_settings
from app.services import email_service

OUT = Path(__file__).resolve().parents[1] / "tmp_emails"
TO = "volunteer@example.com"
NEW = "new-address@example.com"
OLD = "current-address@example.com"
TOKEN = "placeholder-token"
CODE = "123456"
TOURNAMENT = "2026 SoCal Invitational"

Sent = tuple[str, str, str, str]


async def _render_all() -> list[Sent]:
    sent: list[Sent] = []

    async def capture(to: str, subject: str, text: str, html: str) -> None:
        sent.append((to, subject, text, html))

    join_url = f"{get_settings().frontend_url.rstrip('/')}/join?code=ABC123"
    with patch.object(email_service, "_send", capture):
        await email_service.send_sign_in_code_email(TO, CODE)
        await email_service.send_sign_up_code_email(TO, CODE)
        await email_service.send_email_change_email(NEW, TOKEN)
        await email_service.send_email_change_requested_notice(OLD, NEW, TOKEN)
        await email_service.send_password_reset_email(TO, TOKEN)
        await email_service.send_password_changed_notice(TO)
        await email_service.send_account_setup_email(TO, TOKEN)
        await email_service.send_staff_invite_email(TO, TOURNAMENT, join_url)
    return sent


def _write_files(sent: list[Sent]) -> None:
    OUT.mkdir(exist_ok=True)
    (OUT / ".gitignore").write_text("*\n", encoding="utf-8")
    cards = []
    for i, (to, subject, text, body_html) in enumerate(sent, start=1):
        slug = f"{i:02d}"
        (OUT / f"{slug}.html").write_text(body_html, encoding="utf-8")
        (OUT / f"{slug}.txt").write_text(
            f"To: {to}\nSubject: {subject}\n\n{text}", encoding="utf-8"
        )
        cards.append(
            f"<section><h2>{escape(subject)}</h2><p>To: {escape(to)}</p>"
            f'<iframe src="{slug}.html" title="{escape(subject)}"></iframe>'
            f"<details><summary>Plain text</summary><pre>{escape(text)}</pre></details>"
            "</section>"
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


def main() -> None:
    sent = asyncio.run(_render_all())
    _write_files(sent)
    print(f"Wrote {len(sent)} emails to {OUT / 'index.html'}")


if __name__ == "__main__":
    main()
