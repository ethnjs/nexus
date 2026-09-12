from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel

from app.schemas.person import PersonNameRef, PersonRoleRead
from app.schemas.tournament.event import EventMemberRead
from app.schemas.tournament.shift import TournamentShiftBase
from app.schemas.tournament.track import TournamentTrackRef


# ---------------------------------------------------------------------------
# Write schemas
#
# The body names a plain `role_id`, not the `membership_role_id` the column
# actually stores. A caller dragging a member onto an event knows the role it
# wants them in; it has no reason to know the id of that member's join row,
# and would have to fetch it first. The route resolves one to the other,
# granting the role if the member doesn't hold it yet.
# ---------------------------------------------------------------------------
class AssignmentCreate(BaseModel):
    tournament_event_id: int
    membership_id: int
    role_id: int
    # Omitted or null both mean "no specific shift". Legal even on an event
    # that has shifts — some staffing genuinely isn't pinned to one, and test
    # writing has no shifts at all.
    tournament_shift_id: int | None = None
    # Required only when there is no shift, since a shift already names its
    # track and the route takes that as the answer (see
    # resolve_assignment_track). Naming one that disagrees with the shift is a
    # 422 rather than a silent correction.
    tournament_track_id: int | None = None


class AssignmentUpdate(BaseModel):
    """Partial update. Note `tournament_shift_id` is nullable *and* optional,
    which are different things here: omitting it leaves the shift alone, while
    sending an explicit null clears it. Pydantic can't express that in the
    type, so the route reads `model_fields_set` to tell the two apart — see
    update_assignment."""
    role_id: int | None = None
    tournament_shift_id: int | None = None
    # Only read when the row ends up with no shift — pinning it to one takes
    # the track from the shift, whatever this says.
    tournament_track_id: int | None = None


# ---------------------------------------------------------------------------
# Read schema
#
# One shape, not one per position. This is returned by the writes, by the
# assignments collection, and nested under an event via `fields=assignments`
# — three callers, one audience (a TD; every path is gated identically). A
# second, trimmer schema for the nested position would be a schema per caller,
# which is what `fields` exists to avoid.
#
# Nested rather than flattened, and every nested type is one that already
# exists. An assignment is a join, so it should read as the things it joins;
# flattening them into event_name/first_name/role_label meant re-plumbing this
# schema every time an event or a person grew a field.
# ---------------------------------------------------------------------------
class AssignmentRead(BaseModel):
    id: int
    # The member-facing event shape: enough to name and place an event, none
    # of the room/staffing detail the board's chips don't show.
    event: EventMemberRead
    # Not PersonRefResponse — the assignment names its own role just below, so
    # the member's full role list would be noise. See PersonNameRef.
    member: PersonNameRef
    # PersonRoleRead, not RoleRead: `permissions` and `rank` are the
    # tournament's authorization model and have no business on a staffing chip.
    role: PersonRoleRead
    # Null means genuinely unpinned — a real answer, not "you didn't ask".
    # start/end/track_id ride along because the board derives its
    # double-booking and track-status warnings from them client-side.
    shift: TournamentShiftBase | None
    # Never null, unlike the shift: every row is for a track. A pinned row
    # repeats what its shift already says; an unpinned one has this and
    # nothing else, which is how the board knows which of an event's
    # workstreams a chip belongs to.
    track: TournamentTrackRef
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row) -> "AssignmentRead":
        return cls(
            id=row.id,
            event=EventMemberRead.from_row(row.tournament_event),
            member=PersonNameRef.from_membership(row.membership),
            role=PersonRoleRead(
                id=row.membership_role.role_id,
                label=row.membership_role.role.label,
            ),
            shift=(
                TournamentShiftBase.model_validate(row.tournament_shift)
                if row.tournament_shift is not None else None
            ),
            track=TournamentTrackRef.model_validate(row.tournament_track),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
