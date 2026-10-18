"""Discord tables. Relationships point only from these models to NEXUS models, so the NEXUS
models never need to know Discord exists. See backend/docs/discord.md."""

from datetime import datetime
from typing import Literal

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.models import Tournament, TournamentTrack, User, utcnow

CategoryGrouping = Literal["building", "zone"]


class DiscordGuildLink(Base):
    """One Discord server linked to one track. Nothing syncs until `built_at` is set."""

    __tablename__ = "discord_guild_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tournament_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), index=True
    )
    track_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tournament_tracks.id", ondelete="CASCADE"), unique=True
    )
    guild_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    guild_name: Mapped[str | None] = mapped_column(String(100))
    installed_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL")
    )

    # Read only by build and /reset; changing them alone changes nothing in Discord.
    merge_divisions: Mapped[bool] = mapped_column(Boolean, default=False)
    category_grouping: Mapped[str] = mapped_column(String(16), default="building")

    built_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    bot_removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_build_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_build_status: Mapped[str | None] = mapped_column(String(16))
    last_build_error: Mapped[str | None] = mapped_column(Text)
    last_sync_error: Mapped[str | None] = mapped_column(Text)
    # A sync that succeeded but skipped something, such as roles above the bot's.
    last_sync_warning: Mapped[str | None] = mapped_column(Text)

    verified_role_id: Mapped[int | None] = mapped_column(BigInteger)
    owner_role_id: Mapped[int | None] = mapped_column(BigInteger)
    verify_channel_id: Mapped[int | None] = mapped_column(BigInteger)
    verify_message_id: Mapped[int | None] = mapped_column(BigInteger)
    archived_category_id: Mapped[int | None] = mapped_column(BigInteger)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    tournament: Mapped[Tournament] = relationship(Tournament)
    track: Mapped[TournamentTrack] = relationship(TournamentTrack)
    installed_by: Mapped[User | None] = relationship(User)
    managed_roles: Mapped[list["DiscordManagedRole"]] = relationship(
        back_populates="link", cascade="all, delete-orphan", passive_deletes=True
    )
    managed_channels: Mapped[list["DiscordManagedChannel"]] = relationship(
        back_populates="link", cascade="all, delete-orphan", passive_deletes=True
    )
    sync_marks: Mapped[list["DiscordSyncMark"]] = relationship(
        back_populates="link", cascade="all, delete-orphan", passive_deletes=True
    )


class DiscordManagedRole(Base):
    """A Discord role the bot created or adopted for a NEXUS role (`kind` "role") or event
    (`kind` "event"). `nexus_id` has no foreign key: the row outlives the NEXUS object, so the
    reconcile can still find and delete the Discord role."""

    __tablename__ = "discord_managed_roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    link_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("discord_guild_links.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String(8))
    nexus_id: Mapped[int] = mapped_column(Integer)
    discord_role_id: Mapped[int] = mapped_column(BigInteger)
    # How the role was last set up, at creation or /reset; not NEXUS's current permissions.
    tier: Mapped[str | None] = mapped_column(String(8))

    link: Mapped[DiscordGuildLink] = relationship(back_populates="managed_roles")

    __table_args__ = (
        UniqueConstraint("link_id", "kind", "nexus_id", name="uq_discord_managed_role"),
    )


class DiscordManagedChannel(Base):
    """A category or event channel the bot manages. `key` is its identity ("event:12,13",
    "building:5", "zone:3", "other"); names are display only. An archived channel is no longer
    managed and keeps its row only as history."""

    __tablename__ = "discord_managed_channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    link_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("discord_guild_links.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String(8))
    key: Mapped[str] = mapped_column(String(255))
    discord_channel_id: Mapped[int] = mapped_column(BigInteger)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)

    link: Mapped[DiscordGuildLink] = relationship(back_populates="managed_channels")

    __table_args__ = (
        Index(
            "uq_discord_managed_channel_live_key",
            "link_id",
            "key",
            unique=True,
            postgresql_where=text("NOT archived"),
        ),
    )


class DiscordSyncMark(Base):
    """Something in a server to reconcile. Writing the same mark twice merges into one row."""

    __tablename__ = "discord_sync_marks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    link_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("discord_guild_links.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String(16))
    # Set only for kind "member".
    discord_user_id: Mapped[int | None] = mapped_column(BigInteger)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    link: Mapped[DiscordGuildLink] = relationship(back_populates="sync_marks")

    __table_args__ = (
        UniqueConstraint(
            "link_id",
            "kind",
            "discord_user_id",
            name="uq_discord_sync_mark",
            postgresql_nulls_not_distinct=True,
        ),
    )
