from __future__ import annotations
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app.schemas.event import EventResponse
from app.schemas.tournament import VALID_DIVISIONS
from app.schemas.tournament.shift import TournamentShiftBase, TournamentShiftRead
from app.schemas.tournament.track import TournamentTrackRead

VALID_EVENT_TYPES = {"standard", "trial"}


def _clean_rooms(value: list[str]) -> list[str]:
    """Trimmed, blank-free, deduplicated, order preserved.

    Order is the TD's: "210, 212, 214" is how they think of the space, and
    sorting would renumber it for them. Blanks are dropped rather than
    rejected — a room list is edited as a row of tags, and an empty one is a
    tag the TD cleared, not an error worth a 422.
    """
    seen: list[str] = []
    for room in value:
        room = room.strip()
        if room and room not in seen:
            seen.append(room)
    return seen


class EventTrackDetail(BaseModel):
    """One track an event runs on, plus where it happens there.

    Replaces the old `track_ids` outright rather than sitting beside it: a
    list of ids and a list of ids-with-location are two ways to write the
    same thing, and the pair would have to define which wins. A track with no
    location is simply a detail whose fields are all None.

    One building and one floor, but many rooms — an event routinely spreads
    across 210, 212 and 214, while nothing sensible spreads across two
    buildings on one day. The link table's primary key already enforces the
    singular half; nothing needs to enforce it here.
    """

    model_config = ConfigDict(extra="forbid")

    track_id: int
    building_id: int | None = None
    floor: str | None = None
    rooms: list[str] = []

    @field_validator("floor")
    @classmethod
    def _clean_floor(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip() or None

    @field_validator("rooms")
    @classmethod
    def _check_rooms(cls, v: list[str]) -> list[str]:
        return _clean_rooms(v)


class EventTrackDetailRead(EventTrackDetail):
    """The read shape. Carries the building's name because nothing else in an
    event response can supply it — unlike a track, which the `tracks` group
    already spells out in full."""

    building_name: str | None = None

    @classmethod
    def from_row(cls, detail) -> "EventTrackDetailRead":
        return cls(
            track_id=detail.track_id,
            building_id=detail.building_id,
            building_name=detail.building.name if detail.building else None,
            floor=detail.floor,
            rooms=detail.rooms or [],
        )


class EventBase(BaseModel):
    # extra="forbid" so a caller still sending the old start_time/end_time is
    # rejected outright rather than quietly creating an event whose schedule
    # silently didn't save.
    model_config = ConfigDict(extra="forbid")

    # Custom (event_id-less) events only — catalog-linked events display
    # the joined Event.name instead. See the model_validator below.
    name: str | None = None
    division: str | None = None
    event_type: str = "standard"
    event_id: int | None = None
    # An event's schedule *is* its shifts, and the tracks it runs on are
    # stated outright. Both are whole-set: a PATCH sending shift_ids replaces
    # the event's shifts, it doesn't add to them. Omit either to leave it
    # alone. Setting shift_ids also adds those shifts' tracks to
    # track_details — see the route.
    shift_ids: list[int] | None = None
    track_details: list[EventTrackDetail] | None = None

    @field_validator("division")
    @classmethod
    def validate_division(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_DIVISIONS:
            raise ValueError(f"division must be one of: {VALID_DIVISIONS}")
        return v

    @field_validator("event_type")
    @classmethod
    def validate_event_type(cls, v: str) -> str:
        if v not in VALID_EVENT_TYPES:
            raise ValueError(f"event_type must be one of: {VALID_EVENT_TYPES}")
        return v

    @model_validator(mode="after")
    def validate_name_or_event_id(self) -> "EventBase":
        if self.name is None and self.event_id is None:
            raise ValueError("at least one of name or event_id must be set")
        return self


class EventCreate(EventBase):
    tournament_id: int


class EventUpdate(BaseModel):
    """Partial update — all fields optional. Only the fields actually sent
    are validated against each other (mirrors current + incoming values is
    the route's job, not this schema's)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    division: str | None = None
    event_type: str | None = None
    event_id: int | None = None
    # Whole-set, like on create. None means "not sent"; [] means "clear".
    shift_ids: list[int] | None = None
    track_details: list[EventTrackDetail] | None = None

    @field_validator("division")
    @classmethod
    def validate_division(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_DIVISIONS:
            raise ValueError(f"division must be one of: {VALID_DIVISIONS}")
        return v

    @field_validator("event_type")
    @classmethod
    def validate_event_type(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_EVENT_TYPES:
            raise ValueError(f"event_type must be one of: {VALID_EVENT_TYPES}")
        return v


class EventRead(BaseModel):
    id: int
    tournament_id: int
    name: str | None = None
    division: str | None = None
    event_type: str
    event_id: int | None = None
    # Joined canonical event — set only when event_id is set. Carries
    # category, since TournamentEvent no longer has its own category field.
    event: EventResponse | None = None
    # Where the event happens, per track it runs on. Its own group in
    # `fields` (location), separate from `tracks` above: a board that only
    # draws chips wants the track names and none of this.
    track_details: list[EventTrackDetailRead] = []
    shifts: list[TournamentShiftRead] = []
    # The tracks themselves, not just their ids: every staff-side reader of
    # an event wants the track's name and dates, and re-joining them against
    # a separately fetched catalog is the only alternative.
    tracks: list[TournamentTrackRead] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("track_details", mode="before")
    @classmethod
    def _build_track_details(cls, value):
        """Link rows into read shapes, in schedule order.

        from_attributes can't do this alone: `building_name` lives a join away
        (detail.building.name), so plain attribute mapping renders every
        building nameless. Sorting happens here rather than on the
        relationship for the same reason — ordering by the *track's* date
        needs a join the relationship can't express. Cosmetic tracks have no
        date and sort last, matching how `tracks` already orders.
        """
        if value is None:
            return []
        rows = [row for row in value if not isinstance(row, (EventTrackDetailRead, dict))]
        if not rows:
            return list(value)
        return [
            EventTrackDetailRead.from_row(row)
            for row in sorted(
                value,
                key=lambda d: (
                    d.track is None or d.track.start_date is None,
                    d.track.start_date if d.track and d.track.start_date else date.min,
                    d.track_id,
                ),
            )
        ]


class EventMemberRead(BaseModel):
    """The member-facing event shape (?public=true), and the shape any other
    response embeds when it needs to name an event — an assignment, say.

    Still not the staff shape: `track_details` carries the physical room
    assignment, which stays staff-side until the day, along with the staffing
    needs, which are a target rather than anything a member acts on.

    `shifts` used to be excluded on the grounds that publishing them implied a
    schedule the TD hadn't committed to. That no longer holds: members already
    answer availability questions built from these exact shifts, so the
    schedule is not a secret being leaked — it is the thing they were asked
    about. `event_type` joins it because "trial" is something a member should
    be able to see before signing up for an event.
    """
    id: int
    name: str | None = None
    division: str | None = None
    event_type: str = "standard"
    shifts: list[TournamentShiftBase] = []

    @classmethod
    def from_row(cls, event) -> "EventMemberRead":
        # display_name, not name: a catalog-linked event carries its name on
        # the joined canonical Event, leaving its own column null.
        return cls(
            id=event.id,
            name=event.display_name,
            division=event.division,
            event_type=event.event_type,
            shifts=[TournamentShiftBase.model_validate(s) for s in event.shifts],
        )


class EventLoadDefaultsSkipped(BaseModel):
    event_id: int
    division: str
    name: str
    reason: str = "already loaded"


class EventLoadDefaultsResponse(BaseModel):
    created: list[EventRead]
    skipped: list[EventLoadDefaultsSkipped]
