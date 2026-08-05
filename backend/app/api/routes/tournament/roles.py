from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.tournament.audit import (
    ROLE_ASSIGNED,
    ROLE_CREATED,
    ROLE_DELETED,
    ROLE_REMOVED,
    ROLE_UPDATED,
    log_action,
)
from app.core.tournament.permissions import (
    MANAGE_ROLES,
    MANAGE_TOURNAMENT,
    get_highest_rank,
    require_any_permission,
    require_membership,
)
from app.db.session import get_db
from app.models.models import Tournament, TournamentMembership, TournamentMembershipRole, TournamentRole, User
from app.schemas.tournament.role import RoleAssignRequest, RoleDefinition, RoleRead, RoleUpdate
from app.schemas.tournament.membership import MembershipRead
from app.api.routes.tournament.memberships import _get_membership_or_404, _serialize as _serialize_membership

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


def _validate_rank_bound(user: User, tournament: Tournament, rank: int, db: Session) -> None:
    """
    A MANAGE_ROLES holder can never create or edit a role that outranks (or
    ties) their own highest role. Only the Owner and platform admins are
    exempt — MANAGE_TOURNAMENT does NOT bypass this: it's the tournament
    metadata permission, not an implicit "outrank everyone" grant. The
    Tournament Director role holds both MANAGE_TOURNAMENT and MANAGE_ROLES
    and sits at rank 1, so it can still modify every role — that falls out
    of being the highest rank, not a permission bypass.
    """
    if user.id == tournament.owner_id or user.role == "admin":
        return

    actor_rank = get_highest_rank(user, tournament.id, db)
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
# POST /tournaments/{tournament_id}/roles/ — manage_tournament or manage_roles (rank-bound)
# ---------------------------------------------------------------------------
@router.post("/", response_model=RoleRead, status_code=status.HTTP_201_CREATED)
def create_role(
    tournament_id: int,
    payload: RoleDefinition,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_permission(MANAGE_TOURNAMENT, MANAGE_ROLES)),
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
    db.flush()  # get role.id before logging

    log_action(
        db, tournament_id, current_user.id, ROLE_CREATED,
        target_type="role", target_id=role.id,
        extra_data={"key": role.key, "label": role.label, "rank": role.rank, "permissions": role.permissions},
    )

    db.commit()
    db.refresh(role)
    return role


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/roles/{role_id}/ — manage_tournament or manage_roles (rank-bound)
# ---------------------------------------------------------------------------
@router.patch("/{role_id}/", response_model=RoleRead)
def update_role(
    tournament_id: int,
    role_id: int,
    payload: RoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_permission(MANAGE_TOURNAMENT, MANAGE_ROLES)),
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

    changes = {
        field: {"old": getattr(role, field), "new": value}
        for field, value in updates.items()
        if getattr(role, field) != value
    }

    for field, value in updates.items():
        setattr(role, field, value)

    if changes:
        log_action(
            db, tournament_id, current_user.id, ROLE_UPDATED,
            target_type="role", target_id=role.id,
            extra_data={"changes": changes},
        )

    db.commit()
    db.refresh(role)
    return role


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/roles/{role_id}/ — manage_tournament or manage_roles (rank-bound)
# Cascades to MembershipRole rows (FK ondelete="CASCADE") — no blocking check
# for roles currently assigned to members.
# ---------------------------------------------------------------------------
@router.delete("/{role_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(
    tournament_id: int,
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_permission(MANAGE_TOURNAMENT, MANAGE_ROLES)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    role = _get_role_or_404(role_id, tournament_id, db)
    _validate_rank_bound(current_user, tournament, role.rank, db)

    log_action(
        db, tournament_id, current_user.id, ROLE_DELETED,
        target_type="role", target_id=role.id,
        extra_data={"key": role.key, "label": role.label, "rank": role.rank},
    )

    db.delete(role)
    db.commit()


# ---------------------------------------------------------------------------
# Membership role assignment — a sub-resource of memberships, so nested under
# /tournaments/{tournament_id}/memberships/{membership_id}/roles/. Kept in
# this module (not memberships.py) since it's role-management logic gated by
# MANAGE_ROLES, same as the CRUD routes above.
# ---------------------------------------------------------------------------
membership_roles_router = APIRouter(
    prefix="/tournaments/{tournament_id}/memberships/{membership_id}/roles",
    tags=["tournaments"],
)


def _get_role_in_tournament_or_404(role_id: int, tournament_id: int, db: Session) -> TournamentRole:
    role = db.query(TournamentRole).filter(TournamentRole.id == role_id).first()
    if not role or role.tournament_id != tournament_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    return role


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
    rationale as _validate_rank_bound above: it's the tournament metadata
    permission, not a role-management bypass).

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


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/memberships/{membership_id}/roles/
# manage_tournament or manage_roles, rank-bound (see _validate_role_action)
# ---------------------------------------------------------------------------
@membership_roles_router.post(
    "/",
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

    log_action(
        db, tournament_id, current_user.id, ROLE_ASSIGNED,
        target_type="membership", target_id=m.id,
        extra_data={"role_id": role.id, "role_key": role.key, "role_label": role.label},
    )

    db.commit()
    db.refresh(m)
    return _serialize_membership(m)


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/memberships/{membership_id}/roles/{role_id}/
# manage_tournament or manage_roles, rank-bound (see _validate_role_action)
# ---------------------------------------------------------------------------
@membership_roles_router.delete("/{role_id}/", status_code=status.HTTP_204_NO_CONTENT)
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

    log_action(
        db, tournament_id, current_user.id, ROLE_REMOVED,
        target_type="membership", target_id=m.id,
        extra_data={"role_id": role.id, "role_key": role.key, "role_label": role.label},
    )

    db.delete(assignment)
    db.commit()
