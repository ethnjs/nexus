"""Marking servers and members dirty for the leader's drain. A mark is written in the same
transaction as the change that caused it, with a notification that wakes the drain once the
transaction commits."""

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.discord.links import CHANNEL
from app.models.discord import DiscordSyncMark


def _mark(db: Session, link_id: int, kind: str, discord_user_id: int | None) -> None:
    db.execute(
        insert(DiscordSyncMark)
        .values(link_id=link_id, kind=kind, discord_user_id=discord_user_id)
        .on_conflict_do_nothing(constraint="uq_discord_sync_mark")
    )
    db.execute(text("SELECT pg_notify(:channel, '')"), {"channel": CHANNEL})


def mark_member(db: Session, link_id: int, discord_user_id: int) -> None:
    _mark(db, link_id, "member", discord_user_id)


def mark_structure(db: Session, link_id: int) -> None:
    _mark(db, link_id, "structure", None)


def mark_full(db: Session, link_id: int) -> None:
    _mark(db, link_id, "full", None)
