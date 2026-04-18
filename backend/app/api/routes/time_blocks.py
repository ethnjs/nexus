from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import TimeBlock, User
from app.schemas.time_block import TimeBlockCreate, TimeBlockUpdate, TimeBlockRead
from app.core.permissions import MANAGE_EVENTS, VIEW_EVENTS, require_permission

router = APIRouter(prefix="/tournaments/{tournament_id}/blocks", tags=["time-blocks"])



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
