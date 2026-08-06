from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from app.core.auth import get_current_user
from app.core.tournament.permissions import MANAGE_MEMBERS, require_permission
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


def _get_membership_or_404(membership_id: int, tournament_id: int, db: Session) -> TournamentMembership:
    """Fetch membership and validate it belongs to the given tournament."""
    m = db.query(TournamentMembership).filter(TournamentMembership.id == membership_id).first()
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")
    if m.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")
    return m


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/memberships/ — manage_members
# Members-page roster: slim user identity + roles only.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[MembershipSlimResponse])
def list_memberships(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
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
# GET /tournaments/{tournament_id}/memberships/search/?q=&role_id=&exclude_role_id=
# manage_members. Member-data search: searches all tournament members by
# name/email; role_id narrows to members holding that role (powers the roles
# editor's "Manage Members" tab); exclude_role_id drops members who already
# hold that role (powers its "Add Members" picker). role_id and
# exclude_role_id are independent filters and can be combined.
# Registered before "/{membership_id}/" so the literal path always wins.
# Tournaments are small enough (rarely 150+ members) to return the full
# filtered list rather than paginating.
# ---------------------------------------------------------------------------
@router.get("/search/", response_model=list[MembershipSlimResponse])
def search_memberships(
    tournament_id: int,
    q: str | None = Query(default=None),
    role_id: int | None = Query(default=None),
    exclude_role_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    query = (
        db.query(TournamentMembership)
        .join(User, User.id == TournamentMembership.user_id)
        .filter(TournamentMembership.tournament_id == tournament_id)
    )
    if q:
        like = f"%{q}%"
        query = query.filter(
            (User.first_name.ilike(like)) | (User.last_name.ilike(like)) | (User.email.ilike(like))
        )
    if role_id is not None:
        held_role = (
            db.query(TournamentMembershipRole.membership_id)
            .filter(TournamentMembershipRole.role_id == role_id)
        )
        query = query.filter(TournamentMembership.id.in_(held_role))
    if exclude_role_id is not None:
        held_by_role = (
            db.query(TournamentMembershipRole.membership_id)
            .filter(TournamentMembershipRole.role_id == exclude_role_id)
        )
        query = query.filter(TournamentMembership.id.notin_(held_by_role))

    memberships = (
        query
        .options(
            joinedload(TournamentMembership.user),
            joinedload(TournamentMembership.roles).joinedload(TournamentMembershipRole.role),
        )
        .order_by(TournamentMembership.id)
        .all()
    )
    return [MembershipSlimResponse.model_validate(m) for m in memberships]


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/memberships/{membership_id} — manage_members
# ---------------------------------------------------------------------------
@router.get("/{membership_id}/", response_model=MembershipFullResponse)
def get_membership(
    tournament_id: int,
    membership_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    m = _get_membership_or_404(membership_id, tournament_id, db)
    return MembershipFullResponse.model_validate(m)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/memberships/me/ — self-service
# Lets a volunteer update their own onboarding responses. Cannot touch
# day-of logistics (schedule, notes) — that's manage_members-only.
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
# PATCH /tournaments/{tournament_id}/memberships/{membership_id} — manage_members
# Staff override — day-of logistics only (schedule, notes). Not onboarding
# data; that's self-service via PATCH .../me/.
# ---------------------------------------------------------------------------
@router.patch("/{membership_id}/", response_model=MembershipFullResponse)
def update_membership(
    tournament_id: int,
    membership_id: int,
    payload: MembershipCoordinatorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
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
# DELETE /tournaments/{tournament_id}/memberships/{membership_id} — manage_members
# Removes a user from the tournament.
# ---------------------------------------------------------------------------
@router.delete("/{membership_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_membership(
    tournament_id: int,
    membership_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    m = _get_membership_or_404(membership_id, tournament_id, db)
    db.delete(m)
    db.commit()
