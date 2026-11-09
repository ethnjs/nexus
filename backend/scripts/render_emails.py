"""Write every email template to tmp_emails/ for previewing in a browser. Nothing is sent.

    uv run python -m scripts.render_emails

Run from backend/. See docs/email-previews.md.
"""

import asyncio
import html
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.services import email_service

OUT = Path(__file__).resolve().parents[1] / "tmp_emails"
TO = "volunteer@example.com"
NEW = "new-address@example.com"
OLD = "current-address@example.com"
TOKEN = "placeholder-token"
TOURNAMENT = "2026 SoCal Invitational"


class _CapturingClient:
    """Stands in for the SES client, recording each message _send builds."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str, str]] = []

    def send_email(self, **kwargs: Any) -> dict[str, str]:
        content = kwargs["Content"]["Simple"]
        self.sent.append(
            (
                kwargs["Destination"]["ToAddresses"][0],
                content["Subject"]["Data"],
                content["Body"]["Text"]["Data"],
                content["Body"]["Html"]["Data"],
            )
        )
        return {"MessageId": "preview"}


async def _render_all(client: _CapturingClient) -> None:
    settings = get_settings()
    # _send skips without keys; the placeholders never reach AWS because the client is replaced.
    settings.aws_access_key_id = "preview"
    settings.aws_secret_access_key = "preview"
    settings.ses_max_send_rate = 1000
    email_service._get_ses_client = lambda *_args: client
    email_service.create_verification_token = lambda *_args, **_kwargs: TOKEN

    join_url = f"{settings.frontend_url.rstrip('/')}/join?code=ABC123"
    await email_service.send_verification_email(TO, TOKEN)
    await email_service.send_email_change_email(NEW, TOKEN)
    await email_service.send_email_change_requested_notice(None, 1, OLD, NEW)
    await email_service.send_password_reset_email(TO, TOKEN)
    await email_service.send_password_changed_notice(TO)
    await email_service.send_account_setup_email(TO, TOKEN)
    await email_service.send_staff_invite_email(TO, TOURNAMENT, join_url)


def _write_files(sent: list[tuple[str, str, str, str]]) -> None:
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
            f"<section><h2>{html.escape(subject)}</h2><p>To: {html.escape(to)}</p>"
            f'<iframe src="{slug}.html" title="{html.escape(subject)}"></iframe>'
            f"<details><summary>Plain text</summary><pre>{html.escape(text)}</pre></details>"
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
    client = _CapturingClient()
    asyncio.run(_render_all(client))
    _write_files(client.sent)
    print(f"Wrote {len(client.sent)} emails to {OUT / 'index.html'}")


if __name__ == "__main__":
    main()
