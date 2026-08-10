from __future__ import annotations
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.tournament.memberships import resolve_memberships_or_users
from app.core.tournament.permissions import MANAGE_TOURNAMENT, require_permission
from app.db.session import get_db
from app.models.models import AuditLogEntry, User
from app.schemas.tournament.audit import AuditLogEntryRead, AuditLogPage

router = APIRouter(prefix="/tournaments/{tournament_id}/audit-log", tags=["tournaments"])


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/audit-log/ — list audit log entries, newest first. manage_tournament only.
#
# Keyset-paginated on id (insert-order, monotonic PK) rather than offset —
# stays fast at any table size since it's an indexed WHERE id < before_id
# rather than a skip-N-rows scan. Pass the response's next_before_id back as
# ?before_id= to fetch the next page; null means no more results.
#
# Filters are ANDed together, all optional.
# ---------------------------------------------------------------------------
@router.get("/", response_model=AuditLogPage)
def list_audit_log(
    tournament_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    before_id: int | None = Query(default=None),
    action: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    target_id: int | None = Query(default=None),
    actor_id: int | None = Query(default=None),
    since: datetime | None = Query(default=None),
    until: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    query = db.query(AuditLogEntry).filter(AuditLogEntry.tournament_id == tournament_id)

    if before_id is not None:
        query = query.filter(AuditLogEntry.id < before_id)
    if action is not None:
        query = query.filter(AuditLogEntry.action == action)
    if target_type is not None:
        query = query.filter(AuditLogEntry.target_type == target_type)
    if target_id is not None:
        query = query.filter(AuditLogEntry.target_id == target_id)
    if actor_id is not None:
        query = query.filter(AuditLogEntry.actor_id == actor_id)
    if since is not None:
        query = query.filter(AuditLogEntry.created_at >= since)
    if until is not None:
        query = query.filter(AuditLogEntry.created_at <= until)

    items = query.order_by(AuditLogEntry.id.desc()).limit(limit).all()
    next_before_id = items[-1].id if len(items) == limit else None

    actors = resolve_memberships_or_users(db, tournament_id, {entry.actor_id for entry in items})
    entries = [
        AuditLogEntryRead(
            id=entry.id,
            tournament_id=entry.tournament_id,
            action=entry.action,
            target_type=entry.target_type,
            target_id=entry.target_id,
            extra_data=entry.extra_data,
            created_at=entry.created_at,
            actor=actors[entry.actor_id],
        )
        for entry in items
    ]

    return {"items": entries, "next_before_id": next_before_id}
