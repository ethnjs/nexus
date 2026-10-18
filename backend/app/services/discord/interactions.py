"""Discord's interaction protocol: request signatures and response shapes."""

import time
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

PING = 1
APPLICATION_COMMAND = 2
MESSAGE_COMPONENT = 3

PONG = 1
CHANNEL_MESSAGE = 4
DEFERRED_CHANNEL_MESSAGE = 5
UPDATE_MESSAGE = 7

EPHEMERAL = 1 << 6
ACTION_ROW = 1
BUTTON = 2
PRIMARY_STYLE = 1
SECONDARY_STYLE = 2
DANGER_STYLE = 4
LINK_STYLE = 5

MAX_TIMESTAMP_SKEW_SECONDS = 300


def signature_is_valid(public_key: str, signature: str, timestamp: str, body: bytes) -> bool:
    """Discord signs the timestamp plus the exact request bytes with Ed25519."""
    try:
        key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key))
        key.verify(bytes.fromhex(signature), timestamp.encode() + body)
    except (ValueError, InvalidSignature):
        return False
    return True


def timestamp_is_fresh(timestamp: str) -> bool:
    """Whether the signed `X-Signature-Timestamp` is recent, so a captured request can't be
    replayed later."""
    try:
        return abs(time.time() - int(timestamp)) <= MAX_TIMESTAMP_SKEW_SECONDS
    except ValueError:
        return False


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


def button(label: str, custom_id: str, style: int = PRIMARY_STYLE) -> dict[str, Any]:
    return {"type": BUTTON, "style": style, "label": label, "custom_id": custom_id}


def row(*buttons: dict[str, Any]) -> dict[str, Any]:
    return {"type": ACTION_ROW, "components": list(buttons)}


def deferred_reply() -> dict[str, Any]:
    """Discord's "thinking...", for answers that take longer than its 3 seconds. The real answer
    is an edit through the interaction token."""
    return {"type": DEFERRED_CHANNEL_MESSAGE, "data": {"flags": EPHEMERAL}}


def update(content: str, components: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Replaces the message a clicked button sits on."""
    return {
        "type": UPDATE_MESSAGE,
        "data": {
            "content": content,
            "components": components or [],
            "allowed_mentions": {"parse": []},
        },
    }
