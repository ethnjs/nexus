"""Discord's interaction protocol: request signatures and response shapes."""

from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

PING = 1
APPLICATION_COMMAND = 2
MESSAGE_COMPONENT = 3

PONG = 1
CHANNEL_MESSAGE = 4

EPHEMERAL = 1 << 6
ACTION_ROW = 1
BUTTON = 2
LINK_STYLE = 5


def signature_is_valid(public_key: str, signature: str, timestamp: str, body: bytes) -> bool:
    """Discord signs the timestamp plus the exact request bytes with Ed25519."""
    try:
        key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key))
        key.verify(bytes.fromhex(signature), timestamp.encode() + body)
    except (ValueError, InvalidSignature):
        return False
    return True


def link_button(label: str, url: str) -> dict[str, Any]:
    return {
        "type": ACTION_ROW,
        "components": [{"type": BUTTON, "style": LINK_STYLE, "label": label, "url": url}],
    }


def reply(content: str, *, components: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """An ephemeral message only the person who ran the command or clicked can see."""
    data: dict[str, Any] = {
        "content": content,
        "flags": EPHEMERAL,
        "allowed_mentions": {"parse": []},
    }
    if components:
        data["components"] = components
    return {"type": CHANNEL_MESSAGE, "data": data}
