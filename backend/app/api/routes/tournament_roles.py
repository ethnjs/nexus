from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import (
    MANAGE_TOURNAMENT,
    has_permission,
    require_membership,
    require_permission,
)
from app.db.session import get_db
from app.models.models import Tournament, TournamentMembership, TournamentRole, User
from app.schemas.tournament import RoleDefinition, RoleRead, RoleUpdate

# Routes are nested: /tournaments/{tournament_id}/roles/...
# tournament_id is always present in the path, which drives the permission check.
router = APIRouter(prefix="/tournaments/{tournament_id}/roles", tags=["tournaments"])


def _get_role_or_404(role_id: int, tournament_id: int, db: Session) -> TournamentRole:
    """
    Fetch role by ID and validate it belongs to the given tournament.
    Returns 404 if not found or tournament mismatch — prevents cross-tournament access.
    """
    role = db.query(TournamentRole).filter(TournamentRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    if role.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    return role


def _actor_highest_rank(user: User, tournament_id: int, db: Session) -> int | None:
    """Lowest rank number (highest authority) among the user's own roles in this tournament."""
    membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == user.id,
            TournamentMembership.tournament_id == tournament_id,
        )
        .first()
    )
    if not membership:
        return None

    role_ids = [mr.role_id for mr in membership.roles]
    if not role_ids:
        return None

    return (
        db.query(func.min(TournamentRole.rank))
        .filter(TournamentRole.id.in_(role_ids))
        .scalar()
    )


def _validate_rank_bound(user: User, tournament: Tournament, rank: int, db: Session) -> None:
    """
    A staff member can never create or edit a role that outranks (or ties) their
    own highest role. The Owner and anyone with MANAGE_TOURNAMENT are exempt.
    """
    if user.id == tournament.owner_id:
        return
    if has_permission(user, tournament.id, MANAGE_TOURNAMENT, db):
        return

    actor_rank = _actor_highest_rank(user, tournament.id, db)
    if actor_rank is None or rank <= actor_rank:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot create or edit a role at or above your own rank",
        )


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/roles/ — any member can read
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[RoleRead])
def list_roles(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_membership()),
):
    roles = (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament_id)
        .order_by(TournamentRole.rank, TournamentRole.label)
        .all()
    )
    return roles


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/roles/ — manage_tournament
# ---------------------------------------------------------------------------
@router.post("/", response_model=RoleRead, status_code=status.HTTP_201_CREATED)
def create_role(
    tournament_id: int,
    payload: RoleDefinition,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    _validate_rank_bound(current_user, tournament, payload.rank, db)

    existing = (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament_id, TournamentRole.key == payload.key)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Role '{payload.key}' already exists in this tournament",
        )

    role = TournamentRole(tournament_id=tournament_id, **payload.model_dump())
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/roles/{role_id}/ — manage_tournament
# ---------------------------------------------------------------------------
@router.patch("/{role_id}/", response_model=RoleRead)
def update_role(
    tournament_id: int,
    role_id: int,
    payload: RoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    role = _get_role_or_404(role_id, tournament_id, db)
    updates = payload.model_dump(exclude_none=True)

    target_rank = updates.get("rank", role.rank)
    _validate_rank_bound(current_user, tournament, target_rank, db)

    if "key" in updates and updates["key"] != role.key:
        existing = (
            db.query(TournamentRole)
            .filter(TournamentRole.tournament_id == tournament_id, TournamentRole.key == updates["key"])
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Role '{updates['key']}' already exists in this tournament",
            )

    for field, value in updates.items():
        setattr(role, field, value)

    db.commit()
    db.refresh(role)
    return role


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/roles/{role_id}/ — manage_tournament
# Cascades to MembershipRole rows (FK ondelete="CASCADE") — no blocking check
# for roles currently assigned to members.
# ---------------------------------------------------------------------------
@router.delete("/{role_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(
    tournament_id: int,
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    role = _get_role_or_404(role_id, tournament_id, db)
    _validate_rank_bound(current_user, tournament, role.rank, db)

    db.delete(role)
    db.commit()
