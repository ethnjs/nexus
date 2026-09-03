from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _TrackName(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=255)

    @field_validator("name")
    @classmethod
    def _strip_and_require_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class TournamentTrackCreate(_TrackName):
    pass


class TournamentTrackUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=255)
    is_archived: bool | None = None
    allow_confirm: bool | None = None

    @field_validator("name")
    @classmethod
    def _strip_and_require_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class TournamentTrackRead(BaseModel):
    id: int
    tournament_id: int
    name: str
    is_archived: bool
    # Members may self-confirm on this track (see the model). Read by the
    # member page to decide whether to offer the control at all.
    allow_confirm: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MembershipTrackStatusRead(BaseModel):
    """One member's status on one track. Carries the track's `name` alongside
    its id so a renderer never needs a second catalog request — same treatment
    resolve_field_options gives track assignments on a form field.

    `is_archived` comes along because an archived track's statuses stay
    readable: the catalog entry is retired, but the fact that someone
    confirmed for it is still history worth showing."""
    track_id: int
    name: str
    is_archived: bool
    # "interested" | "confirmed" | "declined", or the synthetic "pending" for
    # a track the member has no row for at all — see build_track_statuses.
    # Never accepted on a write; write-through only ever stores the three
    # real statuses (see TRACK_STATUSES).
    status: str
    # None on a "pending" entry: there's no row, so nothing has been updated.
    updated_at: datetime | None = None

    @classmethod
    def from_row(cls, row) -> "MembershipTrackStatusRead":
        """Flattens the track relationship — `name`/`is_archived` live on
        TournamentTrack, not on the status row itself, so from_attributes
        alone can't build this."""
        return cls(
            track_id=row.track_id,
            name=row.track.name,
            is_archived=row.track.is_archived,
            status=row.status,
            updated_at=row.updated_at,
        )
