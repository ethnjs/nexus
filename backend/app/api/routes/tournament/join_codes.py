from __future__ import annotations

from datetime import UTC, datetime, timedelta

import anyio.from_thread
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.join_codes import (
    apply_join_code_update,
    deactivate_join_code,
    get_unique_join_code,
    is_join_code_expired,
)
from app.core.tournament import (
    get_scoped_or_404,
    get_tournament,
    require_not_archived,
    tournament_display_name,
)
from app.core.tournament.audit import (
    INVITE_EMAIL_SENT,
    JOIN_CODE_CREATED,
    JOIN_CODE_DEACTIVATED,
    JOIN_CODE_UPDATED,
    log_action,
)
from app.core.tournament.memberships import resolve_person_refs
from app.core.tournament.permissions import (
    MANAGE_INVITES,
    MANAGE_MEMBERS,
    has_permission,
    require_permission,
)
from app.db.session import get_db
from app.models.models import AuditLogEntry, JoinCode, TournamentRole, User
from app.schemas.join_code import (
    InviteEmailCreate,
    InviteEmailRecipient,
    InviteEmailResponse,
    JoinCodeCreate,
    JoinCodeResponse,
    JoinCodeRoleResponse,
    JoinCodeUpdate,
)
from app.schemas.person import PersonRefResponse
from app.services.email_service import send_invite_emails

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


def _to_response(
    join_code: JoinCode, creators: dict[int | None, PersonRefResponse]
) -> JoinCodeResponse:
    return JoinCodeResponse(
        id=join_code.id,
        code=join_code.code,
        label=join_code.label,
        expires_at=join_code.expires_at,
        created_at=join_code.created_at,
        use_count=join_code.use_count,
        creator=creators[join_code.created_by],
        roles=[
            JoinCodeRoleResponse(id=r.id, label=r.label, has_permissions=bool(r.permissions))
            for r in join_code.roles
        ],
    )


def _require_manage_members(db: Session, tournament_id: int, current_user: User) -> None:
    # Redeeming an invite grants its roles, so setting them is a role assignment.
    if not has_permission(current_user, tournament_id, MANAGE_MEMBERS, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Changing an invite's roles needs the manage members permission",
        )


def _resolve_invite_roles(
    db: Session, tournament_id: int, role_ids: list[int]
) -> list[TournamentRole]:
    """This tournament's roles by id, refusing any that has permissions."""
    if not role_ids:
        return []
    roles = (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament_id, TournamentRole.id.in_(role_ids))
        .order_by(TournamentRole.rank)
        .all()
    )
    if len(roles) != len(set(role_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    if any(r.permissions for r in roles):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only roles with no permissions can be added to an invite",
        )
    return roles


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/join-codes/ — manage_invites
# ---------------------------------------------------------------------------
@router.get("/{tournament_id}/join-codes/", response_model=list[JoinCodeResponse])
def list_join_codes(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_INVITES)),
):
    # Expired codes can't be redeemed, so the invites page doesn't offer them.
    join_codes = (
        db.query(JoinCode)
        .options(selectinload(JoinCode.roles))
        .filter(
            JoinCode.tournament_id == tournament_id,
            JoinCode.is_active == True,
            or_(JoinCode.expires_at.is_(None), JoinCode.expires_at > datetime.now(UTC)),
        )
        .order_by(JoinCode.created_at.desc())
        .all()
    )
    creators = resolve_person_refs(db, tournament_id, {jc.created_by for jc in join_codes})
    return [_to_response(jc, creators) for jc in join_codes]


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/join-codes/ — manage_invites
# ---------------------------------------------------------------------------
@router.post(
    "/{tournament_id}/join-codes/",
    response_model=JoinCodeResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_join_code(
    tournament_id: int,
    payload: JoinCodeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_INVITES)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    if payload.role_ids:
        _require_manage_members(db, tournament_id, current_user)
    roles = _resolve_invite_roles(db, tournament_id, payload.role_ids)

    expires_at = None
    if payload.expires_in_hours is not None:
        expires_at = datetime.now(UTC) + timedelta(hours=payload.expires_in_hours)

    join_code = JoinCode(
        tournament_id=tournament_id,
        created_by=current_user.id,
        code=get_unique_join_code(db),
        label=payload.label,
        expires_at=expires_at,
        is_active=True,
        roles=roles,
    )
    db.add(join_code)
    db.flush()  # get join_code.id before logging

    log_action(
        db,
        tournament_id,
        current_user.id,
        JOIN_CODE_CREATED,
        target_type="join_code",
        target_id=join_code.id,
        extra_data={
            "code": join_code.code,
            "label": join_code.label,
            "expires_in_hours": payload.expires_in_hours,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "roles": [r.label for r in roles],
        },
    )

    db.commit()
    db.refresh(join_code)
    creators = resolve_person_refs(db, tournament_id, {join_code.created_by})
    return _to_response(join_code, creators)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/join-codes/{code_id}/ — manage_invites
# Label, roles and/or extend expiry — see deactivate_join_code() for deactivation.
# ---------------------------------------------------------------------------
@router.patch("/{tournament_id}/join-codes/{code_id}/", response_model=JoinCodeResponse)
def update_join_code(
    tournament_id: int,
    code_id: int,
    payload: JoinCodeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_INVITES)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    join_code = get_scoped_or_404(db, JoinCode, code_id, tournament_id, "Join code")
    old_label = join_code.label
    old_expires_at = join_code.expires_at
    old_roles = [r.label for r in join_code.roles]

    apply_join_code_update(join_code, payload.label, payload.add_hours)
    if payload.role_ids is not None and set(payload.role_ids) != {r.id for r in join_code.roles}:
        _require_manage_members(db, tournament_id, current_user)
        join_code.roles = _resolve_invite_roles(db, tournament_id, payload.role_ids)

    extra_data = {}
    changes = {}
    if payload.label is not None and payload.label != old_label:
        changes["label"] = {"old": old_label, "new": payload.label}
    new_roles = [r.label for r in join_code.roles]
    if new_roles != old_roles:
        changes["roles"] = {"old": old_roles, "new": new_roles}
    if changes:
        extra_data["changes"] = changes
    if payload.add_hours is not None:
        extra_data["add_hours"] = payload.add_hours
        extra_data["expires_at"] = {
            "old": old_expires_at.isoformat() if old_expires_at else None,
            "new": join_code.expires_at.isoformat() if join_code.expires_at else None,
        }

    if extra_data:
        log_action(
            db,
            tournament_id,
            current_user.id,
            JOIN_CODE_UPDATED,
            target_type="join_code",
            target_id=join_code.id,
            extra_data=extra_data,
        )

    db.commit()
    db.refresh(join_code)
    creators = resolve_person_refs(db, tournament_id, {join_code.created_by})
    return _to_response(join_code, creators)


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/join-codes/{code_id}/ — manage_invites
# Deactivates the join code (one-way). The row is kept, so its use_count and
# audit history survive, but GET no longer lists it.
# ---------------------------------------------------------------------------
@router.delete("/{tournament_id}/join-codes/{code_id}/", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_tournament_join_code(
    tournament_id: int,
    code_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_INVITES)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    join_code = get_scoped_or_404(db, JoinCode, code_id, tournament_id, "Join code")
    deactivate_join_code(join_code)

    log_action(
        db,
        tournament_id,
        current_user.id,
        JOIN_CODE_DEACTIVATED,
        target_type="join_code",
        target_id=join_code.id,
        extra_data={"code": join_code.code},
    )

    db.commit()


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/join-codes/{code_id}/emails/ — manage_invites
# Unlike other email routes, it waits for its sends, because the response and
# the audit entry say which addresses the provider refused. The audit entry is
# logged even when some sends fail.
# ---------------------------------------------------------------------------
@router.post(
    "/{tournament_id}/join-codes/{code_id}/emails/",
    response_model=InviteEmailResponse,
    status_code=status.HTTP_201_CREATED,
)
def send_invite_email(
    tournament_id: int,
    code_id: int,
    payload: InviteEmailCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_INVITES)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    join_code = get_scoped_or_404(db, JoinCode, code_id, tournament_id, "Join code")
    if not join_code.is_active or is_join_code_expired(join_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This invite can no longer be used"
        )

    emails = list(dict.fromkeys(e.lower() for e in payload.emails))
    join_url = f"{get_settings().frontend_url.rstrip('/')}/join?code={join_code.code}"
    role_labels = [r.label for r in join_code.roles if not r.permissions]
    failed = anyio.from_thread.run(
        send_invite_emails, emails, tournament_display_name(tournament), join_url, role_labels
    )

    log_action(
        db,
        tournament_id,
        current_user.id,
        INVITE_EMAIL_SENT,
        target_type="join_code",
        target_id=join_code.id,
        extra_data={
            "join_code": join_code.code,
            "label": join_code.label,
            "recipients": [
                {"email": e, "status": "failed" if e in failed else "sent"} for e in emails
            ],
        },
    )

    db.commit()
    return InviteEmailResponse(sent=[e for e in emails if e not in failed], failed=failed)


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/join-codes/emails/ — manage_invites
# One row per recipient of every invite email, newest first, read from the
# invite_email_sent audit entries.
# ---------------------------------------------------------------------------
@router.get("/{tournament_id}/join-codes/emails/", response_model=list[InviteEmailRecipient])
def list_invite_emails(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_INVITES)),
):
    entries = (
        db.query(AuditLogEntry)
        .filter(
            AuditLogEntry.tournament_id == tournament_id,
            AuditLogEntry.action == INVITE_EMAIL_SENT,
        )
        .order_by(AuditLogEntry.created_at.desc(), AuditLogEntry.id.desc())
        .all()
    )
    invite_ids = {e.target_id for e in entries if e.target_id is not None}
    invite_creators = dict(
        db.query(JoinCode.id, JoinCode.created_by).filter(JoinCode.id.in_(invite_ids)).all()
    )
    people = resolve_person_refs(
        db,
        tournament_id,
        {e.actor_id for e in entries} | set(invite_creators.values()),
    )
    return [
        InviteEmailRecipient(
            email=recipient["email"],
            status=recipient["status"],
            join_code_id=entry.target_id,
            join_code=(entry.extra_data or {}).get("join_code"),
            label=(entry.extra_data or {}).get("label"),
            invite_creator=(
                people[invite_creators[entry.target_id]]
                if entry.target_id in invite_creators
                else None
            ),
            sender=people[entry.actor_id],
            sender_name=entry.actor_name,
            sent_at=entry.created_at,
        )
        for entry in entries
        for recipient in (entry.extra_data or {}).get("recipients", [])
    ]
