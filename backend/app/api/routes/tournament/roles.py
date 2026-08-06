from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.tournament.audit import (
    MEMBERSHIP_ROLES_UPDATED,
    ROLE_CREATED,
    ROLE_DELETED,
    ROLE_UPDATED,
    log_action,
)
from app.core.tournament.permissions import (
    DEFAULT_ROLES,
    MANAGE_MEMBERS,
    MANAGE_ROLES,
    get_highest_rank,
    require_membership,
    require_permission,
)
from app.core.tournament.roles import compute_new_rank, rebalance_tournament_ranks
from app.db.session import get_db
from app.models.models import Tournament, TournamentMembership, TournamentMembershipRole, TournamentRole, User
from app.schemas.tournament.role import RoleAssignmentUpdate, RoleDefinition, RoleRead, RoleReorder, RoleUpdate
from app.schemas.tournament.membership import MembershipSlimResponse
from app.api.routes.tournament.memberships import _get_membership_or_404

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
    exempt. MANAGE_TOURNAMENT holders don't even reach this check — role
    routes are gated on MANAGE_ROLES alone, MANAGE_TOURNAMENT is not a
    tournament-admin override. The Tournament Director role holds both and
    sits at the top rank, so it can still modify every role — that falls out
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

    # Defense in depth: a MANAGE_ROLES holder's own rank is always >= the
    # tournament's live minimum rank (their rank comes from a role that
    # exists in this tournament), so this is implied by the check above —
    # but it's checked live rather than against a hardcoded floor, since
    # ranks are sparse now and there's no fixed "1 = top" constant to lean on.
    min_rank = (
        db.query(func.min(TournamentRole.rank))
        .filter(TournamentRole.tournament_id == tournament.id)
        .scalar()
    )
    if min_rank is not None and rank < min_rank:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot create or edit a role above the tournament's highest existing role",
        )


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/roles/apply-template/ — manage_roles
# Bulk-creates DEFAULT_ROLES as real TournamentRole rows. Only valid when the
# tournament has zero roles — this is the empty-state action, not a merge/
# top-up; once any role exists, further changes go through the normal
# create/update/reorder routes below (single source of truth for rank math,
# rather than the frontend replicating it to offer an editable preview).
# Logs one ordinary role_created entry per row — no separate
# roles_template_applied audit action.
# Registered before "/{role_id}/" so the literal path always wins.
# ---------------------------------------------------------------------------
@router.post("/apply-template/", response_model=list[RoleRead], status_code=status.HTTP_201_CREATED)
def apply_default_role_template(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_ROLES)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    existing = db.query(TournamentRole).filter(TournamentRole.tournament_id == tournament_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tournament already has roles — apply-template is only valid when starting from zero",
        )

    roles = [TournamentRole(tournament_id=tournament_id, **r) for r in DEFAULT_ROLES]
    db.add_all(roles)
    db.flush()  # get role ids before logging

    for role in roles:
        log_action(
            db, tournament_id, current_user.id, ROLE_CREATED,
            target_type="role", target_id=role.id,
            extra_data={"label": role.label, "rank": role.rank, "permissions": role.permissions},
        )

    db.commit()
    for role in roles:
        db.refresh(role)
    return roles


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
# POST /tournaments/{tournament_id}/roles/ — manage_roles (rank-bound)
# ---------------------------------------------------------------------------
@router.post("/", response_model=RoleRead, status_code=status.HTTP_201_CREATED)
def create_role(
    tournament_id: int,
    payload: RoleDefinition,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_ROLES)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    _validate_rank_bound(current_user, tournament, payload.rank, db)

    existing = (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament_id, TournamentRole.label == payload.label)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Role '{payload.label}' already exists in this tournament",
        )

    role = TournamentRole(tournament_id=tournament_id, **payload.model_dump())
    db.add(role)
    db.flush()  # get role.id before logging

    log_action(
        db, tournament_id, current_user.id, ROLE_CREATED,
        target_type="role", target_id=role.id,
        extra_data={"label": role.label, "rank": role.rank, "permissions": role.permissions},
    )

    db.commit()
    db.refresh(role)
    return role


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/roles/{role_id}/ — manage_roles (rank-bound)
# ---------------------------------------------------------------------------
@router.patch("/{role_id}/", response_model=RoleRead)
def update_role(
    tournament_id: int,
    role_id: int,
    payload: RoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_ROLES)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    role = _get_role_or_404(role_id, tournament_id, db)
    updates = payload.model_dump(exclude_none=True)

    target_rank = updates.get("rank", role.rank)
    _validate_rank_bound(current_user, tournament, target_rank, db)

    if "label" in updates and updates["label"] != role.label:
        existing = (
            db.query(TournamentRole)
            .filter(TournamentRole.tournament_id == tournament_id, TournamentRole.label == updates["label"])
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Role '{updates['label']}' already exists in this tournament",
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
# PATCH /tournaments/{tournament_id}/roles/{role_id}/reorder/ — manage_roles (rank-bound)
# Drag-to-reorder in the sidebar editor. Body carries drop_type plus whatever
# neighbor rank values the frontend has on hand (see RoleReorder). If there's
# no integer room between the neighbors, rebalances the whole tournament's
# ranks to 10/20/30... first, translates the request's rank values through
# the rebalance's remap, and retries once.
# ---------------------------------------------------------------------------
@router.patch("/{role_id}/reorder/", response_model=RoleRead)
def reorder_role(
    tournament_id: int,
    role_id: int,
    payload: RoleReorder,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_ROLES)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    role = _get_role_or_404(role_id, tournament_id, db)
    old_rank = role.rank  # captured before a possible rebalance mutates it
    # The role's current rank must also be one the actor is allowed to touch —
    # not just the rank it's moving to (a role currently outranking the actor
    # shouldn't be movable just because the destination rank happens to be low).
    _validate_rank_bound(current_user, tournament, old_rank, db)

    kwargs = {
        k: v for k, v in payload.model_dump(exclude={"drop_type"}).items()
        if v is not None
    }

    new_rank = compute_new_rank(payload.drop_type, **kwargs)
    if new_rank is None or new_rank <= 0:
        remap = rebalance_tournament_ranks(db, tournament_id)
        db.flush()
        kwargs = {k: remap.get(v, v) for k, v in kwargs.items()}
        new_rank = compute_new_rank(payload.drop_type, **kwargs)
        if new_rank is None or new_rank <= 0:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Unable to compute a rank for this position",
            )

    _validate_rank_bound(current_user, tournament, new_rank, db)
    role.rank = new_rank

    if old_rank != new_rank:
        log_action(
            db, tournament_id, current_user.id, ROLE_UPDATED,
            target_type="role", target_id=role.id,
            extra_data={"changes": {"rank": {"old": old_rank, "new": new_rank}}},
        )

    db.commit()
    db.refresh(role)
    return role


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/roles/{role_id}/ — manage_roles (rank-bound)
# Cascades to MembershipRole rows (FK ondelete="CASCADE") — no blocking check
# for roles currently assigned to members.
# ---------------------------------------------------------------------------
@router.delete("/{role_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(
    tournament_id: int,
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_ROLES)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    role = _get_role_or_404(role_id, tournament_id, db)
    _validate_rank_bound(current_user, tournament, role.rank, db)

    log_action(
        db, tournament_id, current_user.id, ROLE_DELETED,
        target_type="role", target_id=role.id,
        extra_data={"label": role.label, "rank": role.rank},
    )

    db.delete(role)
    db.commit()


# ---------------------------------------------------------------------------
# Membership role assignment — a sub-resource of memberships, so nested under
# /tournaments/{tournament_id}/memberships/{membership_id}/roles/. Gated on
# MANAGE_MEMBERS (assigning a role to a member is member data, not a
# role-definition edit — see core/tournament/permissions.py), but kept in
# this module rather than memberships.py since it shares _get_role_or_404-
# style helpers and rank-bound logic with the role CRUD routes above.
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
    platform admins bypass entirely — same rationale as _validate_rank_bound
    above: this route is gated on MANAGE_MEMBERS alone, MANAGE_TOURNAMENT is
    not a bypass.

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
# PATCH /tournaments/{tournament_id}/memberships/{membership_id}/roles/
# manage_members, rank-bound (see _validate_role_action)
#
# Assigning/removing a role on a member is member data (this member's role
# assignments), not a role-definition edit — see the MANAGE_ROLES vs
# MANAGE_MEMBERS split documented in core/tournament/permissions.py. Rank
# bounds still apply: a MANAGE_MEMBERS holder can only touch roles at or
# below their own rank, same as before.
#
# Batch add/remove in one call — staff commonly add or remove several roles
# (or a mix of both) on a member at once, so one PATCH covers it instead of
# one POST/DELETE per role. Also keeps the audit log to a single entry per
# staff action rather than one row per role touched.
#
# add/remove entries that are already no-ops (adding a role already held,
# removing one not held) are silently skipped rather than erroring — this is
# a batch operation, one stale entry in a list shouldn't fail the rest.
# Rank-bound validation still runs against every role_id in the request,
# add or remove, whether or not it ends up being a no-op.
# ---------------------------------------------------------------------------
@membership_roles_router.patch("/", response_model=MembershipSlimResponse)
def update_membership_roles(
    tournament_id: int,
    membership_id: int,
    payload: RoleAssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    m = _get_membership_or_404(membership_id, tournament_id, db)

    touched_role_ids = set(payload.add) | set(payload.remove)
    roles_by_id = {
        role_id: _get_role_in_tournament_or_404(role_id, tournament_id, db)
        for role_id in touched_role_ids
    }

    for role in roles_by_id.values():
        _validate_role_action(current_user, tournament, m, role, db)

    currently_held_ids = {
        mr.role_id for mr in
        db.query(TournamentMembershipRole).filter(TournamentMembershipRole.membership_id == m.id).all()
    }

    to_add = [rid for rid in payload.add if rid not in currently_held_ids]
    to_remove = [rid for rid in payload.remove if rid in currently_held_ids]

    for role_id in to_add:
        db.add(TournamentMembershipRole(membership_id=m.id, role_id=role_id))

    if to_remove:
        db.query(TournamentMembershipRole).filter(
            TournamentMembershipRole.membership_id == m.id,
            TournamentMembershipRole.role_id.in_(to_remove),
        ).delete(synchronize_session=False)

    if to_add or to_remove:
        log_action(
            db, tournament_id, current_user.id, MEMBERSHIP_ROLES_UPDATED,
            target_type="membership", target_id=m.id,
            extra_data={
                "added": [
                    {"role_id": rid, "role_label": roles_by_id[rid].label}
                    for rid in to_add
                ],
                "removed": [
                    {"role_id": rid, "role_label": roles_by_id[rid].label}
                    for rid in to_remove
                ],
            },
        )

    db.commit()
    db.refresh(m)
    return MembershipSlimResponse.model_validate(m)
