from __future__ import annotations
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from app.core.auth import get_current_user
from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.display_config import apply_display_config
from app.core.tournament.memberships import (
    ACTIVE_MEMBERSHIP_CLAUSE, gate_age_flags, get_custom_form_answers, get_membership_by_user,
    resolve_memberships_or_users,
)
from app.core.tournament.permissions import (
    MANAGE_MEMBERS, get_user_permissions, require_permission,
)
from app.core.tournament.roles import validate_member_target
from app.db.session import get_db
from app.models.models import (
    Tournament,
    TournamentMembership,
    TournamentMembershipRole,
    TournamentRole,
    User,
)
from app.schemas.tournament.membership import (
    AgeDisclosureRequest, MembershipAvailabilityRead, MembershipCoordinatorUpdate,
    MembershipEventPreferenceRead, MembershipFullResponse, MembershipLunchRead, MembershipMeResponse,
    MembershipMeUpdate, MembershipSlimResponse,
)
from app.schemas.tournament.track import MembershipTrackStatusRead


def _build_me_response(
    db: Session, tournament: Tournament, membership: TournamentMembership, current_user: User,
) -> JSONResponse:
    """Shared by GET .../me/ and POST .../me/age-disclosure/ — both return
    the same shape for the caller's own membership."""
    permissions = sorted(get_user_permissions(current_user, tournament.id, db))
    is_owner = current_user.id == tournament.owner_id
    needs_age_consent = (
        (tournament.collect_is_over_18 or tournament.collect_is_over_21)
        and membership.age_disclosure is None
    )
    resp = MembershipMeResponse(
        membership_id=membership.id, is_owner=is_owner,
        roles=membership.roles, permissions=permissions,
        is_over_18=membership.is_over_18, is_over_21=membership.is_over_21,
        needs_age_consent=needs_age_consent,
        track_statuses=[MembershipTrackStatusRead.from_row(row) for row in membership.track_statuses],
        event_preferences=MembershipEventPreferenceRead.group_rows(membership.event_preferences),
        availability=[MembershipAvailabilityRead.from_row(row) for row in membership.availability_shifts],
        lunch=[MembershipLunchRead.model_validate(row) for row in membership.lunch_selections],
        custom_responses=get_custom_form_answers(db, tournament.id, current_user.id),
    )
    return JSONResponse(gate_age_flags(membership, resp.model_dump(mode="json")))


def _resolve_join_code_creators(db: Session, tournament_id: int, memberships: list[TournamentMembership], responses: list):
    """Overwrites each response's .join_code.creator with a properly
    resolved MembershipSlimResponse|UserSlimResponse. Automatic
    from_attributes validation would otherwise read JoinCode.creator (a
    plain User relationship) and silently fall back to the bare-user branch
    of the union every time, never surfacing the creator's actual
    membership — same fix already applied to JoinCodeResponse.creator and
    AuditLogEntry.actor."""
    creator_ids = {m.join_code.created_by for m in memberships if m.join_code is not None}
    if not creator_ids:
        return
    creators = resolve_memberships_or_users(db, tournament_id, creator_ids)
    for m, resp in zip(memberships, responses):
        if m.join_code is not None:
            resp.join_code.creator = creators[m.join_code.created_by]

# Routes nested: /tournaments/{tournament_id}/memberships/...
router = APIRouter(prefix="/tournaments/{tournament_id}/memberships", tags=["tournaments"])


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/memberships/ — manage_members
# Members-page roster: slim user identity + roles only.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[MembershipSlimResponse])
def list_memberships(
    tournament_id: int,
    include_declined: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    get_tournament(tournament_id, db)

    query = (
        db.query(TournamentMembership)
        .options(
            joinedload(TournamentMembership.user),
            joinedload(TournamentMembership.roles).joinedload(TournamentMembershipRole.role),
            joinedload(TournamentMembership.join_code),
        )
        .filter(TournamentMembership.tournament_id == tournament_id)
    )
    if not include_declined:
        query = query.filter(ACTIVE_MEMBERSHIP_CLAUSE)
    memberships = query.order_by(TournamentMembership.id).all()
    responses = [MembershipSlimResponse.model_validate(m) for m in memberships]
    _resolve_join_code_creators(db, tournament_id, memberships, responses)
    return responses


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/memberships/search/?q=&role_id=&exclude_role_id=&max_rank=
# manage_members. Member-data search: searches all tournament members by
# name/email; role_id narrows to members holding that role (powers the roles
# editor's "Manage Members" tab); exclude_role_id drops members who already
# hold that role (powers its "Add Members" picker). max_rank drops members
# whose highest-authority role ties or outranks that rank (lower rank number
# = more authority) — the frontend passes the caller's own rank so the "Add
# Members" picker never surfaces someone validate_role_action would reject
# anyway. role_id, exclude_role_id, and max_rank are independent filters and
# can be combined.
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
    max_rank: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    # No opt-in here (unlike the roster list) — this powers role-assignment
    # pickers, and a declined member can't meaningfully hold a role anyway.
    query = (
        db.query(TournamentMembership)
        .join(User, User.id == TournamentMembership.user_id)
        .filter(TournamentMembership.tournament_id == tournament_id, ACTIVE_MEMBERSHIP_CLAUSE)
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
    if max_rank is not None:
        # Members with no roles have no authority and always pass. Members
        # with roles are kept only if their highest-authority (lowest rank
        # number) role is strictly less authoritative than max_rank.
        outranks_or_ties = (
            db.query(TournamentMembershipRole.membership_id)
            .join(TournamentRole, TournamentRole.id == TournamentMembershipRole.role_id)
            .group_by(TournamentMembershipRole.membership_id)
            .having(func.min(TournamentRole.rank) <= max_rank)
        )
        query = query.filter(TournamentMembership.id.notin_(outranks_or_ties))

    memberships = (
        query
        .options(
            joinedload(TournamentMembership.user),
            joinedload(TournamentMembership.roles).joinedload(TournamentMembershipRole.role),
            joinedload(TournamentMembership.join_code),
        )
        .order_by(TournamentMembership.id)
        .all()
    )
    responses = [MembershipSlimResponse.model_validate(m) for m in memberships]
    _resolve_join_code_creators(db, tournament_id, memberships, responses)
    return responses


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/memberships/me/ — any member
# Registered before "/{membership_id}/" so the literal path wins.
# ---------------------------------------------------------------------------
@router.get("/me/", response_model=MembershipMeResponse)
def get_my_membership(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Deliberately not require_membership() — that now excludes a declined
    # membership (see has_any_membership), and this route is the escape
    # hatch a declined member needs to see their own status and re-consent.
    # Any authenticated user can reach this; a non-member just gets back
    # membership_id=None, same shape already used for the site-admin-with-
    # no-row case below.
    tournament = get_tournament(tournament_id, db)

    membership = get_membership_by_user(
        db, tournament_id, current_user.id,
        joinedload(TournamentMembership.roles).joinedload(TournamentMembershipRole.role),
    )
    permissions = sorted(get_user_permissions(current_user, tournament_id, db))
    is_owner = current_user.id == tournament.owner_id

    # No row: a site admin who never joined, or any other authenticated user
    # with no relationship to this tournament (this route no longer gates on
    # require_membership() — see above).
    if not membership:
        resp = MembershipMeResponse(
            membership_id=None, is_owner=is_owner, roles=[], permissions=permissions,
        )
        return JSONResponse(gate_age_flags(None, resp.model_dump(mode="json")))

    return _build_me_response(db, tournament, membership, current_user)


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/memberships/me/age-disclosure/ — self-service
# Answers (or re-answers) the age-disclosure prompt. Decline is a *soft*
# decline: it only ever sets a status column, never touches availability,
# lunch, track statuses, or event preferences. Re-consenting from the same
# modal flips the member straight back to active with that data still
# there — no rejoin, no re-onboarding. (2.4d wires "declined" into the
# roster/active-membership queries that must exclude it.)
# ---------------------------------------------------------------------------
@router.post("/me/age-disclosure/", response_model=MembershipMeResponse)
def set_my_age_disclosure(
    tournament_id: int,
    payload: AgeDisclosureRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    membership = get_membership_by_user(
        db, tournament_id, current_user.id,
        joinedload(TournamentMembership.roles).joinedload(TournamentMembershipRole.role),
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")

    membership.age_disclosure = "consented" if payload.consent else "declined"
    membership.age_disclosure_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(membership)

    return _build_me_response(db, tournament, membership, current_user)


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/memberships/{membership_id} — manage_members
# ---------------------------------------------------------------------------
@router.get("/{membership_id}/", response_model=MembershipFullResponse)
def get_membership(
    tournament_id: int,
    membership_id: int,
    surface: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    m = get_scoped_or_404(db, TournamentMembership, membership_id, tournament_id, "Membership")
    resp = MembershipFullResponse.model_validate(m)
    resp.custom_responses = get_custom_form_answers(db, tournament_id, m.user_id)
    _resolve_join_code_creators(db, tournament_id, [m], [resp])
    data = gate_age_flags(m, resp.model_dump(mode="json"))
    data = apply_display_config(m.tournament, surface, data)
    return JSONResponse(data)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/memberships/me/ — self-service
# Lets a volunteer update their own onboarding responses. Cannot touch
# day-of logistics (notes) — that's manage_members-only.
# ---------------------------------------------------------------------------
@router.patch("/me/", response_model=MembershipFullResponse)
def update_my_membership(
    tournament_id: int,
    payload: MembershipMeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    m = get_membership_by_user(db, tournament_id, current_user.id)
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")

    update_data = payload.model_dump(exclude_none=True)

    for field, value in update_data.items():
        setattr(m, field, value)

    db.commit()
    db.refresh(m)
    resp = MembershipFullResponse.model_validate(m)
    resp.custom_responses = get_custom_form_answers(db, tournament_id, m.user_id)
    return JSONResponse(gate_age_flags(m, resp.model_dump(mode="json")))


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/memberships/{membership_id} — manage_members (rank-bound)
# Staff override — day-of logistics only (notes). Not onboarding
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
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    m = get_scoped_or_404(db, TournamentMembership, membership_id, tournament_id, "Membership")
    validate_member_target(current_user, tournament, m, db)

    update_data = payload.model_dump(exclude_none=True)

    for field, value in update_data.items():
        setattr(m, field, value)

    db.commit()
    db.refresh(m)
    resp = MembershipFullResponse.model_validate(m)
    resp.custom_responses = get_custom_form_answers(db, tournament_id, m.user_id)
    return JSONResponse(gate_age_flags(m, resp.model_dump(mode="json")))


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/memberships/me/ — self-service
# Lets a non-owner leave a tournament. The owner must transfer ownership
# first — leaving without doing so would strand the tournament ownerless.
# Registered before "/{membership_id}/" so the literal path wins.
# ---------------------------------------------------------------------------
@router.delete("/me/", status_code=status.HTTP_204_NO_CONTENT)
def leave_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = get_tournament(tournament_id, db)

    if tournament.owner_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transfer ownership before leaving this tournament.",
        )

    m = get_membership_by_user(db, tournament_id, current_user.id)
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")

    db.delete(m)
    db.commit()


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/memberships/{membership_id} — manage_members (rank-bound)
# Removes a user from the tournament. Unlike leave_tournament (DELETE .../me/),
# the actor here isn't necessarily removing themselves, so validate_member_target
# both blocks the owner as a target outright and enforces the same rank
# comparison validate_role_action uses for its target check.
# ---------------------------------------------------------------------------
@router.delete("/{membership_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_membership(
    tournament_id: int,
    membership_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    m = get_scoped_or_404(db, TournamentMembership, membership_id, tournament_id, "Membership")
    validate_member_target(current_user, tournament, m, db)

    db.delete(m)
    db.commit()
