"""Confirming a build preview. Confirm carries a signed token naming the server's link, the kind
of build, and who asked, so only they can confirm it and only for 10 minutes. Compact, because a
Discord button's custom_id holds at most 100 characters."""

import base64
import hashlib
import hmac
import time
from dataclasses import dataclass

from app.core.config import get_settings
from app.core.discord.build import Plan, Target

EXPIRY_SECONDS = 600
DISCORD_ITEMS_PER_GROUP = 10
DISCORD_MESSAGE_LIMIT = 2000


@dataclass(frozen=True)
class PreviewToken:
    link_id: int
    reset: bool
    target: Target | None
    # "u<NEXUS user id>" from NEXUS, "d<Discord user id>" from Discord.
    actor: str
    issued_at: int


def _signature(message: str) -> str:
    key = get_settings().oauth_state_secret.encode()
    digest = hmac.new(key, f"discord-build|{message}".encode(), hashlib.sha256).digest()[:16]
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def sign(link_id: int, reset: bool, target: Target | None, actor: str) -> str:
    scope = f"{target.kind[0]}{target.id}" if target else ""
    message = f"{link_id}.{int(reset)}.{scope}.{actor}.{int(time.time())}"
    return f"{message}.{_signature(message)}"


class PreviewExpired(Exception):
    pass


def verify(token: str) -> PreviewToken | None:
    """The token's contents, or None if it was tampered with. Raises PreviewExpired if it's
    genuine but older than 10 minutes."""
    message, _, signature = token.rpartition(".")
    if not message or not hmac.compare_digest(signature, _signature(message)):
        return None
    try:
        link_id, reset, scope, actor, issued_at = message.split(".")
        target = None
        if scope:
            target = Target("role" if scope[0] == "r" else "channel", int(scope[1:]))
        parsed = PreviewToken(int(link_id), reset == "1", target, actor, int(issued_at))
    except ValueError:
        return None
    if time.time() - parsed.issued_at > EXPIRY_SECONDS:
        raise PreviewExpired
    return parsed


def discord_summary(plan: Plan, title: str, settings_url: str, guide_url: str) -> str:
    """The preview as one Discord message: up to 10 items a heading, then a count."""
    lines = [f"**{title}**"]
    for heading, items in plan.groups():
        lines.append(f"\n**{heading}**")
        lines.extend(f"• {item}" for item in items[:DISCORD_ITEMS_PER_GROUP])
        if len(items) > DISCORD_ITEMS_PER_GROUP:
            lines.append(f"…and {len(items) - DISCORD_ITEMS_PER_GROUP} more")
    if plan.warnings:
        lines.append("\n**Warnings**")
        lines.extend(f"• {w}" for w in plan.warnings)
    if plan.blockers:
        lines.append("\n**Can't continue**")
        lines.extend(f"• {b}" for b in plan.blockers)
    # Angle brackets stop Discord from unfurling the guide into an embed.
    footer = f"\nFull list in NEXUS: {settings_url}\nHow this works: <{guide_url}>"
    text = "\n".join(lines)
    if len(text) + len(footer) > DISCORD_MESSAGE_LIMIT:
        text = text[: DISCORD_MESSAGE_LIMIT - len(footer) - 2] + "…"
    return text + footer
