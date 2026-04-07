from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_admin
from app.core.permissions import (
    DEFAULT_POSITIONS,
    DEFAULT_CATEGORIES,
    MANAGE_TOURNAMENT,
    require_membership,
    require_permission,
    has_any_membership,
)
from app.db.session import get_db
from app.models.models import Membership, Tournament, User, TournamentCategory
from app.schemas.tournament import TournamentCreate, TournamentRead, TournamentUpdate

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


# ---------------------------------------------------------------------------
# GET /tournaments/ — admin only (global list)
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[TournamentRead])
def list_all_tournaments(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    List ALL tournaments. Admin only.
    Regular users should use GET /tournaments/me instead.
    """
    tournaments = db.query(Tournament).order_by(Tournament.created_at.desc()).all()
    return tournaments


# ---------------------------------------------------------------------------
# GET /tournaments/me — tournaments the current user has any membership in
# ---------------------------------------------------------------------------
@router.get("/me/", response_model=list[TournamentRead])
def list_my_tournaments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return all tournaments where the current user has any membership.
    Admins see all tournaments.
    """
    if current_user.role == "admin":
        tournaments = db.query(Tournament).order_by(Tournament.created_at.desc()).all()
    else:
        tournaments = (
            db.query(Tournament)
            .join(Membership, Membership.tournament_id == Tournament.id)
            .filter(Membership.user_id == current_user.id)
            .order_by(Tournament.created_at.desc())
            .all()
        )
    return tournaments


# ---------------------------------------------------------------------------
# POST /tournaments/ — any authenticated user
# Auto-creates a tournament_director membership for the creator.
# ---------------------------------------------------------------------------
@router.post("/", response_model=TournamentRead, status_code=status.HTTP_201_CREATED)
def create_tournament(
    payload: TournamentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = payload.model_dump()

    # Build volunteer_schema — merge the submitted schema with DEFAULT_POSITIONS.
    submitted_schema = payload.volunteer_schema.model_dump()
    if not submitted_schema.get("positions"):
        submitted_schema["positions"] = DEFAULT_POSITIONS
    data["volunteer_schema"] = submitted_schema

    tournament = Tournament(**data, owner_id=current_user.id)
    db.add(tournament)
    db.flush()  # get tournament.id before creating membership and categories

    # Seed DEFAULT_CATEGORIES
    for cat_name in DEFAULT_CATEGORIES:
        db.add(TournamentCategory(
            tournament_id=tournament.id,
            name=cat_name,
            is_custom=False
        ))

    # Auto-create a tournament_director membership for the creator.
    membership = Membership(
        user_id=current_user.id,
        tournament_id=tournament.id,
        positions=["tournament_director"],
        status="confirmed",
    )
    db.add(membership)
    db.commit()
    db.refresh(tournament)
    return tournament


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id} — any member
# ---------------------------------------------------------------------------
@router.get("/{tournament_id}/", response_model=TournamentRead)
def get_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Any user with a membership in this tournament can view it."""
    if not has_any_membership(current_user, tournament_id, db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return tournament


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id} — manage_tournament only
# ---------------------------------------------------------------------------
@router.patch("/{tournament_id}/", response_model=TournamentRead)
def update_tournament(
    tournament_id: int,
    payload: TournamentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    update_data = payload.model_dump(exclude_none=True)

    if "volunteer_schema" in update_data:
        update_data["volunteer_schema"] = payload.volunteer_schema.model_dump()

    for field, value in update_data.items():
        setattr(tournament, field, value)

    db.commit()
    db.refresh(tournament)
    return tournament


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id} — owner or admin only
# ---------------------------------------------------------------------------
@router.delete("/{tournament_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Only the tournament owner (creator) or an admin can delete a tournament."""
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()

    # 404 if no membership (don't leak existence)
    if not has_any_membership(current_user, tournament_id, db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if current_user.role != "admin" and tournament.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the tournament owner can delete this tournament",
        )

    db.delete(tournament)
    db.commit()
