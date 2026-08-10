from __future__ import annotations
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.join_codes import apply_join_code_update, deactivate_join_code, get_unique_join_code
from app.core.tournament.audit import (
    JOIN_CODE_CREATED, JOIN_CODE_DEACTIVATED, JOIN_CODE_UPDATED, STAFF_INVITE_SENT, log_action,
)
from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived, tournament_display_name
from app.core.tournament.memberships import has_any_membership
from app.core.tournament.permissions import MANAGE_INVITES, require_permission
from app.core.auth import get_current_user
from app.db.session import get_db
from app.models.models import JoinCode, TournamentMembership, User
from app.schemas.join_code import JoinCodeCreate, JoinCodeResponse, JoinCodeUpdate, StaffInviteCreate, StaffInviteResponse
from app.schemas.tournament.membership import MembershipSlimResponse
from app.schemas.user import UserSlimResponse
from app.services.email_service import send_staff_invite_emails

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


# ---------------------------------------------------------------------------
# JoinCode.creator is a User relationship, but the response prefers the
# creator's TournamentMembership (falls back to the bare user when they have
# none — e.g. a site admin acting without ever joining). Resolved separately
# rather than via from_attributes so the union picks membership over user
# whenever one exists, not just whichever validates first.
# ---------------------------------------------------------------------------
def _resolve_creators(
    db: Session, tournament_id: int, join_codes: list[JoinCode],
) -> dict[int, MembershipSlimResponse | UserSlimResponse]:
    creator_ids = {jc.created_by for jc in join_codes}
    memberships = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.tournament_id == tournament_id,
            TournamentMembership.user_id.in_(creator_ids),
        )
        .all()
    )
    resolved: dict[int, MembershipSlimResponse | UserSlimResponse] = {
        m.user_id: MembershipSlimResponse.model_validate(m) for m in memberships
    }
    missing_ids = creator_ids - resolved.keys()
    if missing_ids:
        users = db.query(User).filter(User.id.in_(missing_ids)).all()
        resolved.update({u.id: UserSlimResponse.model_validate(u) for u in users})
    return resolved


def _to_response(join_code: JoinCode, creators: dict[int, MembershipSlimResponse | UserSlimResponse]) -> JoinCodeResponse:
    return JoinCodeResponse(
        id=join_code.id,
        code=join_code.code,
        label=join_code.label,
        expires_at=join_code.expires_at,
        created_at=join_code.created_at,
        use_count=join_code.use_count,
        creator=creators[join_code.created_by],
    )


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/join-codes/ — manage_invites
# ---------------------------------------------------------------------------
@router.get("/{tournament_id}/join-codes/", response_model=list[JoinCodeResponse])
def list_join_codes(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_INVITES)),
):
    join_codes = (
        db.query(JoinCode)
        .filter(JoinCode.tournament_id == tournament_id, JoinCode.is_active == True)
        .order_by(JoinCode.created_at.desc())
        .all()
    )
    creators = _resolve_creators(db, tournament_id, join_codes)
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

    expires_at = None
    if payload.expires_in_hours is not None:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=payload.expires_in_hours)

    join_code = JoinCode(
        tournament_id=tournament_id,
        created_by=current_user.id,
        code=get_unique_join_code(db),
        label=payload.label,
        expires_at=expires_at,
        is_active=True,
    )
    db.add(join_code)
    db.flush()  # get join_code.id before logging

    log_action(
        db, tournament_id, current_user.id, JOIN_CODE_CREATED,
        target_type="join_code", target_id=join_code.id,
        extra_data={
            "code": join_code.code,
            "label": join_code.label,
            "expires_in_hours": payload.expires_in_hours,
            "expires_at": expires_at.isoformat() if expires_at else None,
        },
    )

    db.commit()
    db.refresh(join_code)
    creators = _resolve_creators(db, tournament_id, [join_code])
    return _to_response(join_code, creators)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/join-codes/{code_id}/ — manage_invites
# Label and/or extend expiry — see deactivate_join_code() for deactivation.
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

    apply_join_code_update(join_code, payload.label, payload.add_hours)

    extra_data = {}
    if payload.label is not None and payload.label != old_label:
        extra_data["changes"] = {"label": {"old": old_label, "new": payload.label}}
    if payload.add_hours is not None:
        extra_data["add_hours"] = payload.add_hours
        extra_data["expires_at"] = {
            "old": old_expires_at.isoformat() if old_expires_at else None,
            "new": join_code.expires_at.isoformat() if join_code.expires_at else None,
        }

    if extra_data:
        log_action(
            db, tournament_id, current_user.id, JOIN_CODE_UPDATED,
            target_type="join_code", target_id=join_code.id,
            extra_data=extra_data,
        )

    db.commit()
    db.refresh(join_code)
    creators = _resolve_creators(db, tournament_id, [join_code])
    return _to_response(join_code, creators)


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/join-codes/{code_id}/ — manage_invites
# Deactivates the join code (one-way) — does not remove the row, so
# use_count/history stay visible via GET.
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
        db, tournament_id, current_user.id, JOIN_CODE_DEACTIVATED,
        target_type="join_code", target_id=join_code.id,
        extra_data={"code": join_code.code},
    )

    db.commit()


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/staff-invites/ — owner only, no admin
# bypass. Ownership sits above the role/permission system entirely here —
# unlike require_permission(), this doesn't grant site admins access.
# Sends one personalized invite email per address via send_staff_invite_emails
# (parallel, per-recipient — not BCC). join_code_id must already exist; if the
# TD chose "create new code" in the invite modal, the frontend calls
# POST .../join-codes/ first and passes the resulting id here.
#
# Always logs one staff_invite_sent entry, even on partial failure — the join
# code action (an invite attempt) happened regardless of how many sends
# succeeded, so the log entry isn't conditioned on full success. failed is
# included in extra_data only when non-empty.
# ---------------------------------------------------------------------------
@router.post("/{tournament_id}/staff-invites/", response_model=StaffInviteResponse, status_code=status.HTTP_201_CREATED)
async def send_staff_invites(
    tournament_id: int,
    payload: StaffInviteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = get_tournament(tournament_id, db)

    # 404 before 403 — don't leak tournament existence to non-members
    if not has_any_membership(current_user, tournament_id, db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    if tournament.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the tournament owner can send staff invites",
        )

    require_not_archived(tournament)

    join_code = get_scoped_or_404(db, JoinCode, payload.join_code_id, tournament_id, "Join code")

    join_url = f"{get_settings().frontend_url.rstrip('/')}/tournaments/join?code={join_code.code}"
    failed = await send_staff_invite_emails(payload.emails, tournament_display_name(tournament), join_url)
    sent = [e for e in payload.emails if e not in failed]

    extra_data = {"emails": payload.emails, "join_code": join_code.code}
    if failed:
        extra_data["failed"] = failed

    log_action(
        db, tournament_id, current_user.id, STAFF_INVITE_SENT,
        target_type="join_code", target_id=join_code.id,
        extra_data=extra_data,
    )

    db.commit()
    creators = _resolve_creators(db, tournament_id, [join_code])
    return StaffInviteResponse(join_code=_to_response(join_code, creators), sent=sent, failed=failed)
