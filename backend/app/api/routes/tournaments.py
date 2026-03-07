from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import Tournament
from app.schemas.tournament import TournamentCreate, TournamentRead, TournamentUpdate

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


def _serialize(tournament: Tournament) -> dict:
    """
    Convert JSON columns (blocks, volunteer_schema) from their stored dict/list
    form into the nested Pydantic-compatible structure for TournamentRead.
    """
    return {
        "id": tournament.id,
        "name": tournament.name,
        "start_date": tournament.start_date,
        "end_date": tournament.end_date,
        "location": tournament.location,
        "blocks": tournament.blocks or [],
        "volunteer_schema": tournament.volunteer_schema or {"custom_fields": []},
        "created_at": tournament.created_at,
        "updated_at": tournament.updated_at,
    }


@router.get("/", response_model=list[TournamentRead])
def list_tournaments(db: Session = Depends(get_db)):
    tournaments = db.query(Tournament).order_by(Tournament.created_at.desc()).all()
    return [_serialize(t) for t in tournaments]


@router.post("/", response_model=TournamentRead, status_code=status.HTTP_201_CREATED)
def create_tournament(payload: TournamentCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    # Serialize nested Pydantic models to plain dicts for JSON columns
    data["blocks"] = [b.model_dump() for b in payload.blocks]
    data["volunteer_schema"] = payload.volunteer_schema.model_dump()

    tournament = Tournament(**data)
    db.add(tournament)
    db.commit()
    db.refresh(tournament)
    return _serialize(tournament)


@router.get("/{tournament_id}", response_model=TournamentRead)
def get_tournament(tournament_id: int, db: Session = Depends(get_db)):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")
    return _serialize(tournament)


@router.patch("/{tournament_id}", response_model=TournamentRead)
def update_tournament(
    tournament_id: int,
    payload: TournamentUpdate,
    db: Session = Depends(get_db),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    update_data = payload.model_dump(exclude_none=True)

    # Serialize nested models before storing
    if "blocks" in update_data:
        update_data["blocks"] = [b.model_dump() for b in payload.blocks]
    if "volunteer_schema" in update_data:
        update_data["volunteer_schema"] = payload.volunteer_schema.model_dump()

    for field, value in update_data.items():
        setattr(tournament, field, value)

    db.commit()
    db.refresh(tournament)
    return _serialize(tournament)


@router.delete("/{tournament_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tournament(tournament_id: int, db: Session = Depends(get_db)):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")
    db.delete(tournament)
    db.commit()