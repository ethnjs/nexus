from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
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
    require_membership,
    require_permission,
)
from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.roles import compute_new_rank, rebalance_tournament_ranks, validate_rank_bound, validate_role_action
from app.db.session import get_db
from app.models.models import TournamentMembership, TournamentMembershipRole, TournamentRole, User
from app.schemas.tournament.role import RoleAssignmentUpdate, RoleDefinition, RoleRead, RoleReorder, RoleUpdate
from app.schemas.tournament.membership import MembershipSlimResponse

# Routes are nested: /tournaments/{tournament_id}/roles/...
# tournament_id is always present in the path, which drives the permission check.
router = APIRouter(prefix="/tournaments/{tournament_id}/roles", tags=["tournaments"])


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
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

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
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    validate_rank_bound(current_user, tournament, payload.rank, db)

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
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    role = get_scoped_or_404(db, TournamentRole, role_id, tournament_id, "Role")
    updates = payload.model_dump(exclude_none=True)

    target_rank = updates.get("rank", role.rank)
    validate_rank_bound(current_user, tournament, target_rank, db)

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

    changes = []
    for field, value in updates.items():
        old_value = getattr(role, field)
        if old_value == value:
            continue
        if field == "permissions":
            old_set, new_set = set(old_value or []), set(value or [])
            changes.append({
                "field": "permissions",
                "added": sorted(new_set - old_set),
                "removed": sorted(old_set - new_set),
            })
        else:
            changes.append({"field": field, "old": old_value, "new": value})

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
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    role = get_scoped_or_404(db, TournamentRole, role_id, tournament_id, "Role")
    old_rank = role.rank  # captured before a possible rebalance mutates it
    # The role's current rank must also be one the actor is allowed to touch —
    # not just the rank it's moving to (a role currently outranking the actor
    # shouldn't be movable just because the destination rank happens to be low).
    validate_rank_bound(current_user, tournament, old_rank, db)

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

    validate_rank_bound(current_user, tournament, new_rank, db)
    role.rank = new_rank

    if old_rank != new_rank:
        log_action(
            db, tournament_id, current_user.id, ROLE_UPDATED,
            target_type="role", target_id=role.id,
            extra_data={"changes": [{"field": "rank", "old": old_rank, "new": new_rank}]},
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
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    role = get_scoped_or_404(db, TournamentRole, role_id, tournament_id, "Role")
    validate_rank_bound(current_user, tournament, role.rank, db)

    # Count before delete — the FK cascade removes these rows, so this is
    # the only chance to record how many memberships lose the role.
    members_affected = (
        db.query(TournamentMembershipRole)
        .filter(TournamentMembershipRole.role_id == role.id)
        .count()
    )

    log_action(
        db, tournament_id, current_user.id, ROLE_DELETED,
        target_type="role", target_id=role.id,
        extra_data={"label": role.label, "rank": role.rank, "members_affected": members_affected},
    )

    db.delete(role)
    db.commit()


# ---------------------------------------------------------------------------
# Membership role assignment — a sub-resource of memberships, so nested under
# /tournaments/{tournament_id}/memberships/{membership_id}/roles/. Gated on
# MANAGE_MEMBERS (assigning a role to a member is member data, not a
# role-definition edit — see core/tournament/permissions.py), but kept in
# this module rather than memberships.py since it shares get_scoped_or_404
# usage and rank-bound logic with the role CRUD routes above.
# ---------------------------------------------------------------------------
membership_roles_router = APIRouter(
    prefix="/tournaments/{tournament_id}/memberships/{membership_id}/roles",
    tags=["tournaments"],
)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/memberships/{membership_id}/roles/
# manage_members, rank-bound (see validate_role_action in core/tournament/roles.py)
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
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    m = get_scoped_or_404(db, TournamentMembership, membership_id, tournament_id, "Membership")

    touched_role_ids = set(payload.add) | set(payload.remove)
    roles_by_id = {
        role_id: get_scoped_or_404(db, TournamentRole, role_id, tournament_id, "Role")
        for role_id in touched_role_ids
    }

    for role in roles_by_id.values():
        validate_role_action(current_user, tournament, m, role, db)

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
                "added": [roles_by_id[rid].label for rid in to_add],
                "removed": [roles_by_id[rid].label for rid in to_remove],
            },
        )

    db.commit()
    db.refresh(m)
    return MembershipSlimResponse.model_validate(m)
