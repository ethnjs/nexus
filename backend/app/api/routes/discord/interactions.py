"""Discord's interactions endpoint: slash commands and button clicks, sent by Discord straight to
the backend. Registered without the API key dependency, since Discord can't send one; the
Ed25519 signature authenticates every request instead."""

import json
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.discord.deps import require_discord_enabled
from app.core.discord.interactions import handle
from app.db.session import get_db
from app.services.discord.interactions import PING, PONG, signature_is_valid, timestamp_is_fresh

router = APIRouter(tags=["discord"], dependencies=[Depends(require_discord_enabled)])


async def verified_interaction(request: Request) -> dict[str, Any]:
    """The parsed payload, once its signature checks out. Discord signs the exact bytes, so the
    raw body is verified before parsing. It also sends bad signatures on purpose, and removes the
    endpoint if one is ever accepted."""
    body = await request.body()
    signature = request.headers.get("X-Signature-Ed25519", "")
    timestamp = request.headers.get("X-Signature-Timestamp", "")
    if not signature_is_valid(get_settings().discord_public_key, signature, timestamp, body):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid request signature")
    if not timestamp_is_fresh(timestamp):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Stale request timestamp")
    try:
        return json.loads(body)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid JSON") from None


@router.post("/discord/interactions/", include_in_schema=False)
def receive_interaction(
    background_tasks: BackgroundTasks,
    payload: dict[str, Any] = Depends(verified_interaction),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if payload.get("type") == PING:
        return {"type": PONG}
    return handle(db, payload, background_tasks.add_task)
