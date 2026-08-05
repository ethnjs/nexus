from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.tournament.audit import OWNERSHIP_TRANSFERRED, log_action
from app.core.tournament.permissions import (
    DEFAULT_ROLES,
    MANAGE_TOURNAMENT,
    require_membership,
    require_permission,
    has_any_membership,
)
from app.db.session import get_db
from app.models.models import Tournament, TournamentMembership, TournamentMembershipRole, TournamentRole, User
from app.schemas.tournament import (
    TournamentCreate, TournamentRead, TournamentUpdate, TransferOwnershipRequest,
)

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


def _serialize(tournament: Tournament) -> dict:
    return {
        "id": tournament.id,
        "name": tournament.name,
        "start_date": tournament.start_date,
        "end_date": tournament.end_date,
        "location": tournament.location,
        "is_public": tournament.is_public,
        "is_verified": tournament.is_verified,
        "registration_opens_at": tournament.registration_opens_at,
        "owner_id": tournament.owner_id,
        "roles": tournament.roles,
        "created_at": tournament.created_at,
        "updated_at": tournament.updated_at,
    }


# ---------------------------------------------------------------------------
# GET /tournaments/me — tournaments the current user has any membership in.
# ---------------------------------------------------------------------------
@router.get("/me/", response_model=list[TournamentRead])
def list_my_tournaments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all tournaments where the current user has any membership."""
    tournaments = (
        db.query(Tournament)
        .join(TournamentMembership, TournamentMembership.tournament_id == Tournament.id)
        .filter(TournamentMembership.user_id == current_user.id)
        .order_by(Tournament.created_at.desc())
        .all()
    )
    return [_serialize(t) for t in tournaments]


# ---------------------------------------------------------------------------
# POST /tournaments/ — any authenticated user
# Auto-populates DEFAULT_ROLES for the new tournament and assigns the
# creator the Tournament Director role. Custom roles are set up afterward
# via the roles API (POST/PATCH/DELETE /tournaments/{id}/roles/), not at
# creation time.
# ---------------------------------------------------------------------------
@router.post("/", response_model=TournamentRead, status_code=status.HTTP_201_CREATED)
def create_tournament(
    payload: TournamentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = Tournament(**payload.model_dump(), owner_id=current_user.id)
    db.add(tournament)
    db.flush()  # get tournament.id before creating roles/membership

    role_rows = [TournamentRole(tournament_id=tournament.id, **r) for r in DEFAULT_ROLES]
    db.add_all(role_rows)
    db.flush()  # get role ids
    td_role = next(r for r in role_rows if r.key == "tournament_director")

    # Auto-create a confirmed membership for the creator, holding the TD role.
    membership = TournamentMembership(
        user_id=current_user.id,
        tournament_id=tournament.id,
        status="confirmed",
        source="manual",
    )
    db.add(membership)
    db.flush()  # get membership.id
    db.add(TournamentMembershipRole(membership_id=membership.id, role_id=td_role.id))

    db.commit()
    db.refresh(tournament)
    return _serialize(tournament)


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id} — any member
# ---------------------------------------------------------------------------
@router.get("/{tournament_id}/", response_model=TournamentRead)
def get_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_membership()),
):
    """Any user with a membership in this tournament can view it."""
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return _serialize(tournament)


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

    for field, value in update_data.items():
        setattr(tournament, field, value)

    db.commit()
    db.refresh(tournament)
    return _serialize(tournament)


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
    if not has_any_membership(current_user, tournament_id, db) or not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if current_user.role != "admin" and tournament.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the tournament owner can delete this tournament",
        )

    db.delete(tournament)
    db.commit()


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/transfer-ownership/ — owner only
# The old owner keeps whatever TournamentRole assignments they already had —
# no roles are auto-assigned or auto-removed as a side effect of transfer.
# ---------------------------------------------------------------------------
@router.post("/{tournament_id}/transfer-ownership/", response_model=TournamentRead)
def transfer_ownership(
    tournament_id: int,
    payload: TransferOwnershipRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()

    # 404 if no membership (don't leak existence)
    if not has_any_membership(current_user, tournament_id, db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if tournament.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the current owner can transfer ownership",
        )

    new_owner_membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == payload.new_owner_id,
            TournamentMembership.tournament_id == tournament_id,
        )
        .first()
    )
    if not new_owner_membership:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="new_owner_id must already hold a membership in this tournament",
        )

    old_owner_id = tournament.owner_id
    tournament.owner_id = payload.new_owner_id

    log_action(
        db, tournament_id, current_user.id, OWNERSHIP_TRANSFERRED,
        target_type="tournament", target_id=tournament.id,
        extra_data={"old_owner_id": old_owner_id, "new_owner_id": payload.new_owner_id},
    )

    db.commit()
    db.refresh(tournament)
    return _serialize(tournament)