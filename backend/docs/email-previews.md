# Previewing emails

`scripts/render_emails.py` renders every email NEXUS sends, as the recipient would see it, without sending anything. Use it to check a template or copy change, or to show sample emails to someone outside the team.

```bash
cd backend
uv run python -m scripts.render_emails
```

Open `tmp_emails/index.html` in a browser. It shows every email in its own frame, with the plain-text version underneath. The folder also holds each email's `.html` and `.txt` files, and it's gitignored.

Links use `FRONTEND_URL`, so they point at `localhost` by default. For samples that show the real domain, run `FRONTEND_URL=https://nexus.socalscioly.org uv run python -m scripts.render_emails`.

## How it works

- It calls the real senders in `app/services/email_service.py`, so the output always matches the current templates, subjects, footers, and plain-text bodies.
- It replaces `_send()` with a function that records each message, so nothing is sent and no API key is needed.
- Tokens, recipients, and the tournament name are placeholders.
- A new email shows up only once it's called in `_render_all()`, so add any new sender there.
