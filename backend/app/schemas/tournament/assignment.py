from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, ConfigDict


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


class AssignmentUpdate(BaseModel):
    """Partial update. Note `tournament_shift_id` is nullable *and* optional,
    which are different things here: omitting it leaves the shift alone, while
    sending an explicit null clears it. Pydantic can't express that in the
    type, so the route reads `model_fields_set` to tell the two apart — see
    update_assignment."""
    role_id: int | None = None
    tournament_shift_id: int | None = None


# ---------------------------------------------------------------------------
# Read schemas
# ---------------------------------------------------------------------------
class AssignmentShiftRead(BaseModel):
    """The shift an assignment sits in, or null when it isn't pinned to one.

    `start`/`end` ride along rather than being looked up per chip: the board
    derives its double-booking warning from them client-side, and `track_id`
    is what pairs an assignment with the member's status on that track. Both
    warnings would otherwise need a second request per assignment.
    """
    id: int
    track_id: int
    label: str
    start: datetime
    end: datetime

    model_config = ConfigDict(from_attributes=True)


class AssignmentRead(BaseModel):
    """One assignment, as the assignments collection returns it.

    Carries the event, member and role *names* alongside their ids, the same
    bargain MembershipTrackStatusRead strikes with track names — a renderer
    should never need a second catalog request to draw a row it was just
    handed.

    `membership_role_id` is exposed even though no caller writes it: it is the
    row's real identity, and surfacing it makes the "this assignment is why
    that role can't be removed" link traceable from the client.
    """
    id: int
    tournament_event_id: int
    event_name: str | None
    membership_id: int
    first_name: str
    last_name: str
    membership_role_id: int
    role_id: int
    role_label: str
    shift: AssignmentShiftRead | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row) -> "AssignmentRead":
        """Flattens four relationships — none of these names live on the
        assignment row itself, so from_attributes alone can't build this."""
        user = row.membership.user
        return cls(
            id=row.id,
            tournament_event_id=row.tournament_event_id,
            # display_name, not .name: a catalog-linked event carries its name
            # on the joined Event row and reads back nameless without this.
            event_name=row.tournament_event.display_name,
            membership_id=row.membership_id,
            first_name=user.first_name,
            last_name=user.last_name,
            membership_role_id=row.membership_role_id,
            role_id=row.membership_role.role_id,
            role_label=row.membership_role.role.label,
            shift=(
                AssignmentShiftRead.model_validate(row.tournament_shift)
                if row.tournament_shift is not None else None
            ),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


class EventAssignmentRead(BaseModel):
    """The same assignment as an event embeds it, under `fields=assignments`.

    A separate schema from AssignmentRead because the audience differs, not
    the caller: an event's own row already establishes which event this is, so
    repeating `tournament_event_id`/`event_name` on every nested assignment is
    noise. This is a chip face — who, in what role, when.
    """
    id: int
    membership_id: int
    first_name: str
    last_name: str
    role_id: int
    role_label: str
    shift: AssignmentShiftRead | None

    @classmethod
    def from_row(cls, row) -> "EventAssignmentRead":
        user = row.membership.user
        return cls(
            id=row.id,
            membership_id=row.membership_id,
            first_name=user.first_name,
            last_name=user.last_name,
            role_id=row.membership_role.role_id,
            role_label=row.membership_role.role.label,
            shift=(
                AssignmentShiftRead.model_validate(row.tournament_shift)
                if row.tournament_shift is not None else None
            ),
        )
