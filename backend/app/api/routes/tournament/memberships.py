from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from app.core.auth import get_current_user
from app.core.tournament.permissions import (
    MANAGE_TOURNAMENT,
    MANAGE_VOLUNTEERS,
    VIEW_VOLUNTEERS,
    has_permission,
)
from app.db.session import get_db
from app.models.models import (
    Tournament,
    TournamentMembership,
    TournamentMembershipRole,
    User,
)
from app.schemas.tournament.membership import (
    MembershipCoordinatorUpdate, MembershipFullResponse, MembershipMeUpdate, MembershipSlimResponse,
)

# Routes nested: /tournaments/{tournament_id}/memberships/...
router = APIRouter(prefix="/tournaments/{tournament_id}/memberships", tags=["tournaments"])


def _require_read_permission(user: User, tournament_id: int, db: Session) -> None:
    """Raises 403 unless user has view_volunteers, manage_volunteers, or manage_tournament."""
    if not (
        has_permission(user, tournament_id, VIEW_VOLUNTEERS, db)
        or has_permission(user, tournament_id, MANAGE_VOLUNTEERS, db)
        or has_permission(user, tournament_id, MANAGE_TOURNAMENT, db)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )


def _require_write_permission(user: User, tournament_id: int, db: Session) -> None:
    """Raises 403 unless user has manage_volunteers or manage_tournament."""
    if not (
        has_permission(user, tournament_id, MANAGE_VOLUNTEERS, db)
        or has_permission(user, tournament_id, MANAGE_TOURNAMENT, db)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )


def _get_membership_or_404(membership_id: int, tournament_id: int, db: Session) -> TournamentMembership:
    """Fetch membership and validate it belongs to the given tournament."""
    m = db.query(TournamentMembership).filter(TournamentMembership.id == membership_id).first()
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")
    if m.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")
    return m


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/memberships/ — view_volunteers+
# Members-page roster: slim user identity + roles only.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[MembershipSlimResponse])
def list_memberships(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_read_permission(current_user, tournament_id, db)

    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    memberships = (
        db.query(TournamentMembership)
        .options(
            joinedload(TournamentMembership.user),
            joinedload(TournamentMembership.roles).joinedload(TournamentMembershipRole.role),
        )
        .filter(TournamentMembership.tournament_id == tournament_id)
        .order_by(TournamentMembership.id)
        .all()
    )
    return [MembershipSlimResponse.model_validate(m) for m in memberships]


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/memberships/{membership_id} — view_volunteers+
# ---------------------------------------------------------------------------
@router.get("/{membership_id}/", response_model=MembershipFullResponse)
def get_membership(
    tournament_id: int,
    membership_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_read_permission(current_user, tournament_id, db)
    m = _get_membership_or_404(membership_id, tournament_id, db)
    return MembershipFullResponse.model_validate(m)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/memberships/me/ — self-service
# Lets a volunteer update their own onboarding responses. Cannot touch
# day-of logistics (schedule, notes) — that's manage_volunteers-only.
# ---------------------------------------------------------------------------
@router.patch("/me/", response_model=MembershipFullResponse)
def update_my_membership(
    tournament_id: int,
    payload: MembershipMeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == tournament_id,
            TournamentMembership.user_id == current_user.id,
        )
        .first()
    )
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")

    update_data = payload.model_dump(exclude_none=True)
    if "availability" in update_data and payload.availability:
        update_data["availability"] = [s.model_dump() for s in payload.availability]

    for field, value in update_data.items():
        setattr(m, field, value)

    db.commit()
    db.refresh(m)
    return MembershipFullResponse.model_validate(m)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/memberships/{membership_id} — manage_volunteers+
# Staff override — day-of logistics only (schedule, notes). Not onboarding
# data; that's self-service via PATCH .../me/.
# ---------------------------------------------------------------------------
@router.patch("/{membership_id}/", response_model=MembershipFullResponse)
def update_membership(
    tournament_id: int,
    membership_id: int,
    payload: MembershipCoordinatorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_write_permission(current_user, tournament_id, db)
    m = _get_membership_or_404(membership_id, tournament_id, db)

    update_data = payload.model_dump(exclude_none=True)
    if "schedule" in update_data and payload.schedule:
        update_data["schedule"] = [s.model_dump() for s in payload.schedule]

    for field, value in update_data.items():
        setattr(m, field, value)

    db.commit()
    db.refresh(m)
    return MembershipFullResponse.model_validate(m)


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/memberships/{membership_id} — manage_volunteers+
# Removes a user from the tournament.
# ---------------------------------------------------------------------------
@router.delete("/{membership_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_membership(
    tournament_id: int,
    membership_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_write_permission(current_user, tournament_id, db)
    m = _get_membership_or_404(membership_id, tournament_id, db)
    db.delete(m)
    db.commit()
