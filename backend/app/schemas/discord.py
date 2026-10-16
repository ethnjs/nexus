from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, PlainSerializer

from app.models.discord import CategoryGrouping

# Discord ids pass 2^53, so they'd lose precision as JSON numbers in the browser.
Snowflake = Annotated[int, PlainSerializer(str, return_type=str)]


class DiscordLinkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    guild_id: Snowflake
    guild_name: str | None
    merge_divisions: bool
    category_grouping: CategoryGrouping
    installed_by_name: str | None = None
    built_at: datetime | None
    bot_removed_at: datetime | None
    last_build_at: datetime | None
    last_build_status: str | None
    last_build_error: str | None
    last_sync_error: str | None
    created_at: datetime


class DiscordTrackStatus(BaseModel):
    track_id: int
    # Null when no server is linked to the track.
    link: DiscordLinkResponse | None


class DiscordLinkUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    merge_divisions: bool | None = None
    category_grouping: CategoryGrouping | None = None
