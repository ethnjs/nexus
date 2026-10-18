"""What the leader does with gateway events. Servers without a link are ignored, and so are
links that don't sync. Each handler only marks things dirty; the drain does the work."""

from collections.abc import Callable

from sqlalchemy.orm import Session

from app.core.discord.links import link_for_guild
from app.core.discord.marks import mark_full, mark_member, mark_structure
from app.models.discord import DiscordGuildLink, DiscordManagedChannel, DiscordManagedRole
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


def syncing_link(db: Session, guild_id: int) -> DiscordGuildLink | None:
    link = link_for_guild(db, guild_id)
    if (
        link is None
        or link.built_at is None
        or link.bot_removed_at is not None
        or link.tournament.is_archived
        or link.track.is_archived
    ):
        return None
    return link


def member_joined(db: Session, guild_id: int, user_id: int) -> None:
    """Verifies a linked, eligible member within seconds, before they ever click Verify."""
    link = syncing_link(db, guild_id)
    if link is not None:
        mark_member(db, link.id, user_id)
        db.commit()


def role_deleted(db: Session, guild_id: int, role_id: int) -> None:
    """A full mark, since recreating the role means giving it back to its holders."""
    link = syncing_link(db, guild_id)
    if link is None:
        return
    managed = role_id in (link.owner_role_id, link.verified_role_id) or (
        db.query(DiscordManagedRole).filter_by(link_id=link.id, discord_role_id=role_id).first()
        is not None
    )
    if managed:
        mark_full(db, link.id)
        db.commit()


def channel_deleted(db: Session, guild_id: int, channel_id: int) -> None:
    link = syncing_link(db, guild_id)
    if link is None:
        return
    managed = channel_id == link.verify_channel_id or (
        db.query(DiscordManagedChannel)
        .filter_by(link_id=link.id, discord_channel_id=channel_id, archived=False)
        .first()
        is not None
    )
    if managed:
        mark_structure(db, link.id)
        db.commit()


def channel_created(db: Session, guild_id: int) -> None:
    """Gives staff roles their overwrite on the new channel within seconds."""
    link = syncing_link(db, guild_id)
    if link is not None:
        mark_structure(db, link.id)
        db.commit()


def role_overwrites_removed(db: Session, guild_id: int, role_ids: set[int]) -> None:
    """A staff role taken off a channel's permission list entirely gets its allow back."""
    link = syncing_link(db, guild_id)
    if link is None:
        return
    staff = (
        db.query(DiscordManagedRole)
        .filter(
            DiscordManagedRole.link_id == link.id,
            DiscordManagedRole.tier == "staff",
            DiscordManagedRole.discord_role_id.in_(role_ids),
        )
        .first()
    )
    if staff is not None:
        mark_structure(db, link.id)
        db.commit()


class DatabaseEvents:
    @staticmethod
    def _run(fn: Callable[..., None], *args: object) -> None:
        from app.db.session import SessionLocal

        with SessionLocal() as db:
            fn(db, *args)

    def guild_removed(self, guild_id: int) -> None:
        self._run(mark_bot_removed, guild_id)

    def guild_renamed(self, guild_id: int, name: str) -> None:
        self._run(rename_guild, guild_id, name)

    def member_joined(self, guild_id: int, user_id: int) -> None:
        self._run(member_joined, guild_id, user_id)

    def role_deleted(self, guild_id: int, role_id: int) -> None:
        self._run(role_deleted, guild_id, role_id)

    def channel_deleted(self, guild_id: int, channel_id: int) -> None:
        self._run(channel_deleted, guild_id, channel_id)

    def channel_created(self, guild_id: int) -> None:
        self._run(channel_created, guild_id)

    def role_overwrites_removed(self, guild_id: int, role_ids: set[int]) -> None:
        self._run(role_overwrites_removed, guild_id, role_ids)
