from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.tournament.audit import (
    OWNERSHIP_TRANSFERRED, TOURNAMENT_ARCHIVED, TOURNAMENT_UNARCHIVED, log_action,
)
# Aliased — this module's own GET /{tournament_id}/ route handler is also
# named get_tournament, which would otherwise collide.
from app.core.tournament import get_tournament as fetch_tournament, require_not_archived
from app.core.join_codes import deactivate_tournament_join_codes
from app.core.tournament.memberships import has_any_membership
from app.core.tournament.permissions import (
    MANAGE_TOURNAMENT,
    require_membership,
    require_permission,
)
from app.db.session import get_db
from app.models.models import Tournament, TournamentMembership, User
from app.schemas.tournament import (
    TournamentCreate, TournamentRead, TournamentSummary, TournamentUpdate, TransferOwnershipRequest,
)

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


def _serialize(tournament: Tournament) -> dict:
    return {
        "id": tournament.id,
        "name": tournament.name,
        "short_name": tournament.short_name,
        "start_date": tournament.start_date,
        "end_date": tournament.end_date,
        "university": tournament.university,
        "location": tournament.location,
        "state": tournament.state,
        "level": tournament.level,
        "division": tournament.division,
        "is_public": tournament.is_public,
        "is_verified": tournament.is_verified,
        "is_archived": tournament.is_archived,
        "owner_id": tournament.owner_id,
        "roles": tournament.roles,
        "created_at": tournament.created_at,
        "updated_at": tournament.updated_at,
    }


# ---------------------------------------------------------------------------
# GET /tournaments/me — tournaments the current user has any membership in.
# ---------------------------------------------------------------------------
@router.get("/me/", response_model=list[TournamentSummary])
def list_my_tournaments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all tournaments where the current user has any membership."""
    tournaments = (
        db.query(Tournament)
        .join(TournamentMembership, TournamentMembership.tournament_id == Tournament.id)
        .filter(TournamentMembership.user_id == current_user.id)
        .order_by(Tournament.created_at.desc())
        .all()
    )
    return [
        TournamentSummary(
            **_serialize(t),
            event_count=len(t.events),
            volunteer_count=len(t.memberships),
        )
        for t in tournaments
    ]


# ---------------------------------------------------------------------------
# POST /tournaments/ — any authenticated user
# New tournaments start with zero TournamentRole rows — the Owner already has
# full permissions via the owner_id short-circuit in get_user_permissions(),
# so they can operate immediately and set up roles later (empty-state "apply
# default template" flow, or custom roles) via the roles API.
# ---------------------------------------------------------------------------
@router.post("/", response_model=TournamentRead, status_code=status.HTTP_201_CREATED)
def create_tournament(
    payload: TournamentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = Tournament(**payload.model_dump(exclude_none=True), owner_id=current_user.id)
    db.add(tournament)

    try:
        db.flush()  # get tournament.id before creating membership
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Confirmed membership for the creator, no roles yet — owner_id alone
    # already grants full permissions.
    membership = TournamentMembership(
        user_id=current_user.id,
        tournament_id=tournament.id,
        status="confirmed",
        source="manual",
    )
    db.add(membership)

    db.commit()
    db.refresh(tournament)
    return _serialize(tournament)


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id} — any member
# ---------------------------------------------------------------------------
@router.get("/{tournament_id}/", response_model=TournamentRead)
def get_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_membership()),
):
    """Any user with a membership in this tournament can view it."""
    tournament = fetch_tournament(tournament_id, db)
    return _serialize(tournament)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id} — manage_tournament only
# ---------------------------------------------------------------------------
@router.patch("/{tournament_id}/", response_model=TournamentRead)
def update_tournament(
    tournament_id: int,
    payload: TournamentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_TOURNAMENT)),
):
    tournament = fetch_tournament(tournament_id, db)
    require_not_archived(tournament)

    # exclude_unset (not exclude_none) — a client swapping location<->university
    # must be able to explicitly send the cleared field as null; exclude_none
    # would silently drop it before it ever reaches setattr.
    update_data = payload.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(tournament, field, value)

    try:
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    db.refresh(tournament)
    return _serialize(tournament)


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id} — owner or admin only
# ---------------------------------------------------------------------------
@router.delete("/{tournament_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Only the tournament owner (creator) or an admin can delete a tournament."""
    tournament = fetch_tournament(tournament_id, db)

    # 404 if no membership (don't leak existence)
    if not has_any_membership(current_user, tournament_id, db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if current_user.role != "admin" and tournament.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the tournament owner can delete this tournament",
        )

    require_not_archived(tournament)

    db.delete(tournament)
    db.commit()


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/archive/ — owner or admin only
# ---------------------------------------------------------------------------
@router.post("/{tournament_id}/archive/", response_model=TournamentRead)
def archive_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = fetch_tournament(tournament_id, db)

    if not has_any_membership(current_user, tournament_id, db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if current_user.role != "admin" and tournament.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the tournament owner can archive this tournament",
        )

    tournament.is_archived = True
    tournament.archive_override_at = None
    deactivate_tournament_join_codes(db, tournament_id)

    log_action(
        db, tournament_id, current_user.id, TOURNAMENT_ARCHIVED,
        target_type="tournament", target_id=tournament.id,
    )

    db.commit()
    db.refresh(tournament)
    return _serialize(tournament)


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/unarchive/ — owner or admin, admin-only
# once the tournament has ended. A tournament past its end_date was (or will
# be) auto-archived as a historical record — only an admin can pull it back
# out, same as the doc's "rare case" framing. One still archived ahead of its
# end_date (a manual archive) stays owner-unarchivable.
# ---------------------------------------------------------------------------
@router.post("/{tournament_id}/unarchive/", response_model=TournamentRead)
def unarchive_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = fetch_tournament(tournament_id, db)

    if not has_any_membership(current_user, tournament_id, db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    has_ended = tournament.end_date is not None and tournament.end_date < date.today()

    if current_user.role != "admin":
        if has_ended:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only an admin can unarchive a tournament that has already ended",
            )
        if tournament.owner_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the tournament owner can unarchive this tournament",
            )

    tournament.is_archived = False
    
    if has_ended:
        tournament.archive_override_at = datetime.now(timezone.utc)

    log_action(
        db, tournament_id, current_user.id, TOURNAMENT_UNARCHIVED,
        target_type="tournament", target_id=tournament.id,
    )

    db.commit()
    db.refresh(tournament)
    return _serialize(tournament)


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/transfer-ownership/ — owner only
# The old owner keeps whatever TournamentRole assignments they already had —
# no roles are auto-assigned or auto-removed as a side effect of transfer.
# ---------------------------------------------------------------------------
@router.post("/{tournament_id}/transfer-ownership/", response_model=TournamentRead)
def transfer_ownership(
    tournament_id: int,
    payload: TransferOwnershipRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = fetch_tournament(tournament_id, db)

    # 404 if no membership (don't leak existence)
    if not has_any_membership(current_user, tournament_id, db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if tournament.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the current owner can transfer ownership",
        )

    new_owner_membership = (
        db.query(TournamentMembership)
        .filter(
            TournamentMembership.user_id == payload.new_owner_id,
            TournamentMembership.tournament_id == tournament_id,
        )
        .first()
    )
    if not new_owner_membership:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="new_owner_id must already hold a membership in this tournament",
        )

    old_owner_id = tournament.owner_id
    tournament.owner_id = payload.new_owner_id

    def _display_name(user: User) -> str:
        name = f"{user.first_name or ''} {user.last_name or ''}".strip()
        return name or user.email

    log_action(
        db, tournament_id, current_user.id, OWNERSHIP_TRANSFERRED,
        target_type="tournament", target_id=tournament.id,
        extra_data={
            "old": {"id": old_owner_id, "name": _display_name(current_user)},
            "new": {"id": payload.new_owner_id, "name": _display_name(new_owner_membership.user)},
        },
    )

    db.commit()
    db.refresh(tournament)
    return _serialize(tournament)