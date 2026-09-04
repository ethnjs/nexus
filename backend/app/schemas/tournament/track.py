from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.university import UniversityResponse

VALID_DIVISIONS = {"A", "B", "C"}


def _validate_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("name must not be blank")
    return value


def _validate_division(value: list[str]) -> list[str]:
    if not value:
        raise ValueError("division must have at least one entry")
    invalid = set(value) - VALID_DIVISIONS
    if invalid:
        raise ValueError(f"division must be a subset of: {sorted(VALID_DIVISIONS)}")
    return sorted(set(value))


class _TrackFields(BaseModel):
    """The when/where/what a primary track carries. All optional at this
    layer because a cosmetic track has none of them; which combinations are
    legal is decided by `require_primary_fields` below, in one place, so
    Create and Update can't drift."""

    model_config = ConfigDict(extra="forbid")

    is_primary: bool = False
    start_date: date | None = None
    end_date: date | None = None
    university_id: int | None = None
    location: str | None = None
    division: list[str] | None = None

    @field_validator("division")
    @classmethod
    def _check_division(cls, value: list[str] | None) -> list[str] | None:
        return _validate_division(value) if value is not None else value


def require_primary_fields(track) -> None:
    """The primary/cosmetic invariant, shared by create and update.

    A primary track is a real competition day: the tournament derives its own
    dates, venue and divisions from it (Tournament.primary_tracks), and shifts
    validate against its range — none of which works with a hole in it. A
    cosmetic track is the opposite: carrying a venue it doesn't have would
    show up in the tournament's derived location."""
    if track.is_primary:
        missing = [
            name for name, value in (
                ("start_date", track.start_date),
                ("end_date", track.end_date),
                ("division", track.division),
            ) if not value
        ]
        if missing:
            raise ValueError(f"a primary track requires: {', '.join(missing)}")
        if bool(track.university_id) == bool(track.location):
            raise ValueError(
                "a primary track must have exactly one of university_id or location, not both"
            )
    else:
        present = [
            name for name, value in (
                ("start_date", track.start_date),
                ("end_date", track.end_date),
                ("university_id", track.university_id),
                ("location", track.location),
                ("division", track.division),
            ) if value
        ]
        if present:
            raise ValueError(
                f"only a primary track can have: {', '.join(present)}"
            )

    if track.start_date and track.end_date and track.end_date < track.start_date:
        raise ValueError("end_date must be on or after start_date")


class TournamentTrackCreate(_TrackFields):
    name: str = Field(max_length=255)
    allow_confirm: bool = False

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _validate_name(value)

    @model_validator(mode="after")
    def _check_primary(self) -> TournamentTrackCreate:
        require_primary_fields(self)
        return self


class TournamentTrackUpdate(BaseModel):
    """Partial update. Unlike Create it can't validate the primary invariant
    on its own — a PATCH sending only `location` has to be judged against the
    track's stored dates and division. The route merges this onto the row and
    calls `require_primary_fields` on the result (see _validate_state).

    `is_archived` is deliberately absent: pending-delete is set by
    DELETE /tracks/ and cleared by POST /tracks/{id}/restore/, never by a
    TD toggling a field."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=255)
    allow_confirm: bool | None = None
    is_primary: bool | None = None
    start_date: date | None = None
    end_date: date | None = None
    university_id: int | None = None
    location: str | None = None
    division: list[str] | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str | None) -> str | None:
        return _validate_name(value) if value is not None else value

    @field_validator("division")
    @classmethod
    def _check_division(cls, value: list[str] | None) -> list[str] | None:
        return _validate_division(value) if value is not None else value


class TournamentTrackRead(BaseModel):
    id: int
    tournament_id: int
    name: str
    is_primary: bool
    start_date: date | None = None
    end_date: date | None = None
    university: UniversityResponse | None = None
    location: str | None = None
    division: list[str] | None = None
    # Pending delete — see the model. Only ever true in the tournament
    # settings listing; every other audience filters these out.
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
    # Whether the member may confirm themselves on this track. Rides along
    # because GET /tracks/ is manage_tournament-gated, so the member page has
    # no other way to learn it — and without it, it can't tell whether to
    # offer a Confirm control at all.
    allow_confirm: bool = False
    # None on a "pending" entry: there's no row, so nothing has been updated.
    updated_at: datetime | None = None

    @classmethod
    def from_row(cls, row) -> "MembershipTrackStatusRead":
        """Flattens the track relationship — `name`/`is_archived`/
        `allow_confirm` live on TournamentTrack, not on the status row
        itself, so from_attributes alone can't build this."""
        return cls(
            track_id=row.track_id,
            name=row.track.name,
            is_archived=row.track.is_archived,
            status=row.status,
            allow_confirm=row.track.allow_confirm,
            updated_at=row.updated_at,
        )


class TournamentTrackDeleteResult(BaseModel):
    """What DELETE /tracks/{id}/ actually did. Two outcomes share one route
    because the TD's next action differs: a purged track is gone, a pending
    one is waiting on them to repoint what `blocked_by` names."""

    purged: bool
    # Human-readable TD-authored references still pointing at the track.
    # Empty exactly when `purged` is true.
    blocked_by: list[str] = []
    # Member rows the purge destroys (or will destroy, once unblocked) —
    # shown before the fact so the cost of the delete is never a surprise.
    member_rows_deleted: int = 0
