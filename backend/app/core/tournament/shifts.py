from __future__ import annotations

from itertools import pairwise

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.models import TournamentEvent, TournamentShift


def lock_events(db: Session, event_ids: list[int]) -> None:
    """Row-lock events until commit, so two requests changing one event's shifts take
    turns and the second sees the first's times. Call before reading `event.shifts`."""
    if event_ids:
        db.query(TournamentEvent.id).filter(TournamentEvent.id.in_(event_ids)).order_by(
            TournamentEvent.id
        ).with_for_update().all()


def require_no_overlap(shifts: list[TournamentShift], event: TournamentEvent | None = None) -> None:
    """409 if two of an event's shifts overlap; shifts that only touch are fine.
    Pass `event` to name it in the message, for when the TD isn't looking at it."""
    ordered = sorted(shifts, key=lambda s: s.start)
    for earlier, later in pairwise(ordered):
        if later.start < earlier.end:
            where = f" on {event.display_name}" if event and event.display_name else ""
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Shift '{later.label}' overlaps '{earlier.label}'{where} "
                    "— an event's shifts must not overlap"
                ),
            )
