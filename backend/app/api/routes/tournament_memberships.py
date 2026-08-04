from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from app.core.auth import get_current_user
from app.core.permissions import (
    MANAGE_ROLES,
    MANAGE_TOURNAMENT,
    MANAGE_VOLUNTEERS,
    VIEW_VOLUNTEERS,
    get_highest_rank,
    has_permission,
    require_any_permission,
    require_permission,
)
from app.db.session import get_db
from app.models.models import (
    Event, Tournament, TournamentMembership, TournamentMembershipRole, TournamentRole, User,
)
from app.schemas.tournament_membership import (
    MembershipCreate, MembershipRead, MembershipUpdate, MembershipReadFlat, RoleAssignRequest,
)

# Routes nested: /tournaments/{tournament_id}/memberships/...
router = APIRouter(prefix="/tournaments/{tournament_id}/memberships", tags=["tournaments"])


def _serialize(m: TournamentMembership, include_user: bool = False) -> dict:
    """Serialize membership, converting availability and schedule slots to dicts.

    Pass include_user=True in list views to embed user name/email inline,
    avoiding O(n) follow-up requests from the frontend.
    """
    data = {
        "id": m.id,
        "user_id": m.user_id,
        "tournament_id": m.tournament_id,
        "assigned_event_id": m.assigned_event_id,
        "positions": m.positions,
        "schedule": m.schedule,
        "status": m.status,
        "role_preference": m.role_preference,
        "event_preference": m.event_preference,
        "availability": m.availability,
        "lunch_order": m.lunch_order,
        "notes": m.notes,
        "extra_data": m.extra_data,
        "created_at": m.created_at,
        "updated_at": m.updated_at,
        # TODO(temp): remove when user account self-management is implemented
        "shirt_size": m.shirt_size,
        "dietary_restriction": m.dietary_restriction,
        "university": m.university,
        "major": m.major,
        "employer": m.employer,
        "student_status": m.student_status,
        "competition_exp": m.competition_exp,
        "volunteering_exp": m.volunteering_exp,
    }

    if include_user:
        # Pass the ORM object directly — Pydantic will serialize it via
        # from_attributes=True on UserRead, so all required fields are included.
        data["user"] = m.user if m.user else None

    return data


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
# Returns MembershipReadWithUser: user name/email embedded via JOIN (1 query).
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[MembershipReadFlat])
def list_memberships(
    tournament_id: int,
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all memberships for a tournament, with user identity fields flattened inline.

    Uses joinedload so SQLAlchemy fetches users in a single JOIN rather than
    issuing a separate SELECT per membership (fixes O(n) query issue #4).
    Optionally filter by ?status=confirmed.
    """
    _require_read_permission(current_user, tournament_id, db)

    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    query = (
        db.query(TournamentMembership)
        .options(joinedload(TournamentMembership.user))
        .filter(TournamentMembership.tournament_id == tournament_id)
    )
    if status_filter:
        query = query.filter(TournamentMembership.status == status_filter)

    results = []
    for m in query.order_by(TournamentMembership.id).all():
        data = _serialize(m)
        # TODO(temp): these fields are sourced from User — when the user profile
        # page is built, the full user profile (beyond identity) should continue
        # to come from User, not TournamentMembership.
        data["first_name"] = m.user.first_name if m.user else None
        data["last_name"] = m.user.last_name if m.user else None
        data["email"] = m.user.email if m.user else None
        data["phone"] = m.user.phone if m.user else None
        results.append(data)
    return results


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/memberships/{membership_id} — view_volunteers+
# ---------------------------------------------------------------------------
@router.get("/{membership_id}/", response_model=MembershipRead)
def get_membership(
    tournament_id: int,
    membership_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_read_permission(current_user, tournament_id, db)
    m = _get_membership_or_404(membership_id, tournament_id, db)
    return _serialize(m)


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/memberships/ — manage_volunteers+
# ---------------------------------------------------------------------------
@router.post("/", response_model=MembershipRead, status_code=status.HTTP_201_CREATED)
def create_membership(
    tournament_id: int,
    payload: MembershipCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_write_permission(current_user, tournament_id, db)

    # Validate tournament_id in body matches path
    if payload.tournament_id != tournament_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tournament_id in body does not match URL",
        )

    user = db.query(User).filter(User.id == payload.user_id).first()  # type: ignore[arg-type]
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if payload.assigned_event_id:
        event = db.query(Event).filter(
            Event.id == payload.assigned_event_id,
            Event.tournament_id == tournament_id,
        ).first()
        if not event:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found in this tournament")

    existing = db.query(TournamentMembership).filter(
        TournamentMembership.user_id == payload.user_id,
        TournamentMembership.tournament_id == tournament_id,
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Membership already exists for this user and tournament",
        )

    data = payload.model_dump()
    if data.get("availability"):
        data["availability"] = [s.model_dump() for s in payload.availability]
    if data.get("schedule"):
        data["schedule"] = [s.model_dump() for s in payload.schedule]

    membership = TournamentMembership(**data)
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return _serialize(membership)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/memberships/{membership_id} — manage_volunteers+
# ---------------------------------------------------------------------------
@router.patch("/{membership_id}/", response_model=MembershipRead)
def update_membership(
    tournament_id: int,
    membership_id: int,
    payload: MembershipUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """TD/volunteer-coordinator manual override — can update any field."""
    _require_write_permission(current_user, tournament_id, db)
    m = _get_membership_or_404(membership_id, tournament_id, db)

    if payload.assigned_event_id is not None:
        event = db.query(Event).filter(
            Event.id == payload.assigned_event_id,
            Event.tournament_id == tournament_id,
        ).first()
        if not event:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found in this tournament")

    update_data = payload.model_dump(exclude_none=True)

    if "availability" in update_data and payload.availability:
        update_data["availability"] = [s.model_dump() for s in payload.availability]

    if "schedule" in update_data and payload.schedule:
        update_data["schedule"] = [s.model_dump() for s in payload.schedule]

    # Merge extra_data — tournament-specific fields accumulate over time
    if "extra_data" in update_data and payload.extra_data:
        merged_extra = dict(m.extra_data or {})
        merged_extra.update(payload.extra_data)
        update_data["extra_data"] = merged_extra

    for field, value in update_data.items():
        setattr(m, field, value)

    db.commit()
    db.refresh(m)
    return _serialize(m)


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/memberships/{membership_id} — manage_volunteers+
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


def _validate_role_action(
    actor: User,
    tournament: Tournament,
    membership: TournamentMembership,
    role: TournamentRole,
    db: Session,
) -> None:
    """
    Rank-bound checks for assigning/removing `role` on `membership`. Owner and
    platform admins bypass entirely — MANAGE_TOURNAMENT does NOT bypass (same
    rationale as tournament_roles.py's rank bound: it's the tournament
    metadata permission, not a role-management bypass).

    Two independent checks, both must pass:
      1. The role being assigned/removed must not outrank the actor's own
         highest rank. Self-demotion is naturally exempt (a role you're
         removing from yourself is by definition one of your own roles, so
         it can never outrank your own highest rank); self-promotion
         (assigning yourself a role above your own rank) is blocked like
         any other case.
      2. The target member's highest-ranked role overall must not outrank
         the actor — except when acting on your own membership, where this
         is a no-op (you can't outrank yourself).
    """
    if actor.id == tournament.owner_id or actor.role == "admin":
        return

    actor_rank = get_highest_rank(actor, tournament.id, db)
    if actor_rank is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    if role.rank < actor_rank:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot assign or remove a role that outranks your own",
        )

    is_self = membership.user_id == actor.id
    if not is_self:
        target_rank = get_highest_rank(membership.user, tournament.id, db)
        if target_rank is not None and target_rank < actor_rank:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot modify roles for a member who outranks you",
            )


def _get_role_in_tournament_or_404(role_id: int, tournament_id: int, db: Session) -> TournamentRole:
    role = db.query(TournamentRole).filter(TournamentRole.id == role_id).first()
    if not role or role.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    return role


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/memberships/{membership_id}/roles/
# manage_tournament or manage_roles, rank-bound (see _validate_role_action)
# ---------------------------------------------------------------------------
@router.post(
    "/{membership_id}/roles/",
    response_model=MembershipRead,
    status_code=status.HTTP_201_CREATED,
)
def assign_role(
    tournament_id: int,
    membership_id: int,
    payload: RoleAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_permission(MANAGE_TOURNAMENT, MANAGE_ROLES)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    m = _get_membership_or_404(membership_id, tournament_id, db)
    role = _get_role_in_tournament_or_404(payload.role_id, tournament_id, db)

    existing = (
        db.query(TournamentMembershipRole)
        .filter(TournamentMembershipRole.membership_id == m.id, TournamentMembershipRole.role_id == role.id)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Member already holds this role",
        )

    _validate_role_action(current_user, tournament, m, role, db)

    db.add(TournamentMembershipRole(membership_id=m.id, role_id=role.id))
    db.commit()
    db.refresh(m)
    return _serialize(m)


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/memberships/{membership_id}/roles/{role_id}/
# manage_tournament or manage_roles, rank-bound (see _validate_role_action)
# ---------------------------------------------------------------------------
@router.delete("/{membership_id}/roles/{role_id}/", status_code=status.HTTP_204_NO_CONTENT)
def remove_role(
    tournament_id: int,
    membership_id: int,
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_permission(MANAGE_TOURNAMENT, MANAGE_ROLES)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    m = _get_membership_or_404(membership_id, tournament_id, db)
    role = _get_role_in_tournament_or_404(role_id, tournament_id, db)

    assignment = (
        db.query(TournamentMembershipRole)
        .filter(TournamentMembershipRole.membership_id == m.id, TournamentMembershipRole.role_id == role.id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member does not hold this role")

    _validate_role_action(current_user, tournament, m, role, db)

    db.delete(assignment)
    db.commit()