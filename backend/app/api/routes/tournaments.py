from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_td_or_admin
from app.db.session import get_db
from app.models.models import Tournament, User
from app.schemas.tournament import TournamentCreate, TournamentRead, TournamentUpdate

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


def _serialize(tournament: Tournament) -> dict:
    return {
        "id": tournament.id,
        "name": tournament.name,
        "start_date": tournament.start_date,
        "end_date": tournament.end_date,
        "location": tournament.location,
        "blocks": tournament.blocks or [],
        "volunteer_schema": tournament.volunteer_schema or {"custom_fields": []},
        "owner_id": tournament.owner_id,
        "created_at": tournament.created_at,
        "updated_at": tournament.updated_at,
    }


def _get_tournament_or_404(tournament_id: int, db: Session, current_user: User) -> Tournament:
    q = db.query(Tournament).filter(Tournament.id == tournament_id)
    if current_user.role != "admin":
        q = q.filter(Tournament.owner_id == current_user.id)
    tournament = q.first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return tournament


@router.get("/", response_model=list[TournamentRead])
def list_tournaments(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_td_or_admin),
):
    q = db.query(Tournament)
    if current_user.role != "admin":
        q = q.filter(Tournament.owner_id == current_user.id)
    tournaments = q.order_by(Tournament.created_at.desc()).all()
    return [_serialize(t) for t in tournaments]


@router.post("/", response_model=TournamentRead, status_code=status.HTTP_201_CREATED)
def create_tournament(
    payload: TournamentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_td_or_admin),
):
    data = payload.model_dump()
    data["blocks"] = [b.model_dump() for b in payload.blocks]
    data["volunteer_schema"] = payload.volunteer_schema.model_dump()
    tournament = Tournament(**data, owner_id=current_user.id)
    db.add(tournament)
    db.commit()
    db.refresh(tournament)
    return _serialize(tournament)


@router.get("/{tournament_id}/", response_model=TournamentRead)
def get_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_td_or_admin),
):
    return _serialize(_get_tournament_or_404(tournament_id, db, current_user))


@router.patch("/{tournament_id}/", response_model=TournamentRead)
def update_tournament(
    tournament_id: int,
    payload: TournamentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_td_or_admin),
):
    tournament = _get_tournament_or_404(tournament_id, db, current_user)
    update_data = payload.model_dump(exclude_none=True)
    if "blocks" in update_data:
        update_data["blocks"] = [b.model_dump() for b in payload.blocks]
    if "volunteer_schema" in update_data:
        update_data["volunteer_schema"] = payload.volunteer_schema.model_dump()
    for field, value in update_data.items():
        setattr(tournament, field, value)
    db.commit()
    db.refresh(tournament)
    return _serialize(tournament)


@router.delete("/{tournament_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_td_or_admin),
):
    tournament = _get_tournament_or_404(tournament_id, db, current_user)
    db.delete(tournament)
    db.commit()