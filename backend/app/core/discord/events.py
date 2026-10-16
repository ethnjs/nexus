"""What the leader does with gateway events. Servers without a link are ignored."""

from sqlalchemy.orm import Session

from app.core.discord.links import link_for_guild
from app.models.models import utcnow


def mark_bot_removed(db: Session, guild_id: int) -> None:
    link = link_for_guild(db, guild_id)
    if link is not None and link.bot_removed_at is None:
        link.bot_removed_at = utcnow()
        db.commit()


def rename_guild(db: Session, guild_id: int, name: str) -> None:
    link = link_for_guild(db, guild_id)
    if link is not None and link.guild_name != name:
        link.guild_name = name
        db.commit()


class DatabaseEvents:
    def guild_removed(self, guild_id: int) -> None:
        from app.db.session import SessionLocal

        with SessionLocal() as db:
            mark_bot_removed(db, guild_id)

    def guild_renamed(self, guild_id: int, name: str) -> None:
        from app.db.session import SessionLocal

        with SessionLocal() as db:
            rename_guild(db, guild_id, name)
