from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import TimeBlock, Event, User
from app.schemas.time_block import TimeBlockCreate, TimeBlockUpdate, TimeBlockRead
from app.core.permissions import MANAGE_EVENTS, VIEW_EVENTS, require_permission

router = APIRouter(prefix="/tournaments/{tournament_id}/blocks", tags=["time-blocks"])


def _to_minutes(t: str) -> int:
    """Convert 'HH:MM' to minutes since midnight."""
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _intervals_overlap(s1: int, e1: int, s2: int, e2: int) -> bool:
    """Return True if two time intervals overlap on a 24-hour clock.

    Midnight-spanning blocks have end <= start.  Each is split into up to two
    sub-ranges so wrap-around is handled correctly.  Adjacent blocks
    (end == other.start) do NOT overlap.
    """
    def to_ranges(s: int, e: int) -> list[tuple[int, int]]:
        return [(s, 1440), (0, e)] if e <= s else [(s, e)]

    for a, b in to_ranges(s1, e1):
        for c, d in to_ranges(s2, e2):
            if a < d and b > c:
                return True
    return False


def _check_overlap(
    db: Session,
    tournament_id: int,
    date: str,
    start: str,
    end: str,
    exclude_id: int | None = None,
) -> None:
    """Raise 409 if the given block overlaps any existing block on the same date."""
    cand_start = _to_minutes(start)
    cand_end = _to_minutes(end)

    query = db.query(TimeBlock).filter(
        TimeBlock.tournament_id == tournament_id,
        TimeBlock.date == date,
    )
    if exclude_id is not None:
        query = query.filter(TimeBlock.id != exclude_id)

    for block in query.all():
        b_start = _to_minutes(block.start)
        b_end = _to_minutes(block.end)

        if _intervals_overlap(cand_start, cand_end, b_start, b_end):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Time block overlaps with an existing block.",
                    "conflict": {
                        "id": block.id,
                        "label": block.label,
                        "date": block.date,
                        "start": block.start,
                        "end": block.end,
                    },
                },
            )


@router.get("/", response_model=list[TimeBlockRead])
def list_time_blocks(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(VIEW_EVENTS)),
):
    """List all time blocks for a tournament, ordered by date and start time."""
    return (
        db.query(TimeBlock)
        .filter(TimeBlock.tournament_id == tournament_id)
        .order_by(TimeBlock.date, TimeBlock.start)
        .all()
    )


@router.post("/", response_model=TimeBlockRead, status_code=status.HTTP_201_CREATED)
def create_time_block(
    tournament_id: int,
    payload: TimeBlockCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    """Create a new time block."""
    _check_overlap(db, tournament_id, payload.date, payload.start, payload.end)
    db_block = TimeBlock(**payload.model_dump(), tournament_id=tournament_id)
    db.add(db_block)
    db.commit()
    db.refresh(db_block)
    return db_block


@router.patch("/{block_id}/", response_model=TimeBlockRead)
def update_time_block(
    tournament_id: int,
    block_id: int,
    payload: TimeBlockUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    """Update a time block."""
    db_block = (
        db.query(TimeBlock)
        .filter(TimeBlock.id == block_id, TimeBlock.tournament_id == tournament_id)
        .first()
    )
    if not db_block:
        raise HTTPException(status_code=404, detail="Time block not found")

    update_data = payload.model_dump(exclude_none=True)

    # Determine the effective date/start/end after applying the patch
    effective_date = update_data.get("date", db_block.date)
    effective_start = update_data.get("start", db_block.start)
    effective_end = update_data.get("end", db_block.end)
    _check_overlap(db, tournament_id, effective_date, effective_start, effective_end, exclude_id=block_id)

    for field, value in update_data.items():
        setattr(db_block, field, value)

    db.commit()
    db.refresh(db_block)
    return db_block


@router.delete("/{block_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_time_block(
    tournament_id: int,
    block_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_EVENTS)),
):
    """Delete a time block. Returns 409 if events are assigned."""
    db_block = (
        db.query(TimeBlock)
        .filter(TimeBlock.id == block_id, TimeBlock.tournament_id == tournament_id)
        .first()
    )
    if not db_block:
        raise HTTPException(status_code=404, detail="Time block not found")

    # Check for assigned events
    if db_block.events:
        affected_events = [
            {"id": e.id, "name": e.name, "division": e.division}
            for e in db_block.events
        ]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "This block has assigned events and cannot be deleted.",
                "affected_events": affected_events,
            },
        )

    db.delete(db_block)
    db.commit()
