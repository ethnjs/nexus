from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.auth import get_current_user
from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.display_config import (
    apply_display_config,
    viewer_display_config,
)
from app.core.tournament.field_groups import (
    AVAILABILITY,
    CUSTOM,
    EVENT_PREFS,
    LUNCH,
    MEMBERSHIP,
    ONBOARDING,
    ROLES,
    TRACKS,
    dump_exclude,
    field_selection,
    loader_options,
    resolve_fields,
    wants,
)
from app.core.tournament.member_filters import (
    apply_member_filters,
    apply_member_search,
    build_filter_options,
    filter_age_flags,
    filter_onboarding,
)
from app.core.tournament.member_summary import build_member_summary
from app.core.tournament.memberships import (
    build_event_preferences,
    build_lunch,
    build_track_statuses,
    delete_tournament_form_responses,
    enrich_built_groups,
    gate_age_flags,
    get_custom_form_answers,
    get_membership_by_user,
    onboarding_reads,
    resolve_person_refs,
)
from app.core.tournament.onboarding import needs_tournament_onboarding
from app.core.tournament.permissions import (
    MANAGE_MEMBERS,
    get_user_permissions,
    require_permission,
)
from app.core.tournament.roles import validate_member_target
from app.db.session import get_db
from app.models.models import (
    Tournament,
    TournamentMembership,
    User,
)
from app.schemas.tournament.member_summary import MemberSummaryResponse
from app.schemas.tournament.membership import (
    AgeDisclosureRequest,
    MembershipAvailabilityRead,
    MembershipCoordinatorUpdate,
    MembershipFullResponse,
    MembershipMeResponse,
)


def _no_membership_response(
    db: Session,
    tournament: Tournament,
    current_user: User,
    requested: frozenset[str] | None = None,
) -> JSONResponse:
    resp = MembershipMeResponse(
        is_owner=current_user.id == tournament.owner_id,
        roles=[],
        permissions=sorted(get_user_permissions(current_user, tournament.id, db)),
    )
    data = resp.model_dump(mode="json", exclude=dump_exclude(requested))
    return JSONResponse(gate_age_flags(None, data))


def _build_me_response(
    db: Session,
    tournament: Tournament,
    membership: TournamentMembership,
    current_user: User,
    requested: frozenset[str] | None = None,
) -> JSONResponse:
    """Shared by GET .../me/ and POST .../me/age-disclosure/ — both return
    the same shape for the caller's own membership.

    Every builder below is a query, and this route runs on every dashboard
    page load (MyMembershipProvider wraps the whole tournament section), so
    `requested` gating them is not a micro-optimisation: the provider reads
    four identity fields and nothing else, and says so with fields=roles.
    """
    held_permissions = get_user_permissions(current_user, tournament.id, db)
    permissions = sorted(held_permissions)
    is_owner = current_user.id == tournament.owner_id
    needs_age_consent = (
        (tournament.collect_is_over_18 or tournament.collect_is_over_21)
        and membership.age_disclosure is None
        and not is_owner
    )
    resp = MembershipMeResponse(
        id=membership.id,
        created_at=membership.created_at,
        updated_at=membership.updated_at,
        user=membership.user,
        is_owner=is_owner,
        permissions=permissions,
        needs_age_consent=needs_age_consent,
        needs_onboarding=needs_tournament_onboarding(db, membership, held_permissions),
        roles=membership.held_roles if wants(requested, ROLES) else [],
        is_over_18=membership.is_over_18,
        is_over_21=membership.is_over_21,
        # build_track_statuses rather than the raw rows: it pads every live
        # track the member has no row for as "pending".
        track_statuses=build_track_statuses(db, membership) if wants(requested, TRACKS) else [],
        event_preferences=build_event_preferences(db, membership)
        if wants(requested, EVENT_PREFS)
        else [],
        availability=[
            MembershipAvailabilityRead.from_row(row, tournament)
            for row in membership.availability_shifts
        ]
        if wants(requested, AVAILABILITY)
        else [],
        lunch=build_lunch(db, membership) if wants(requested, LUNCH) else [],
        custom_responses=(
            get_custom_form_answers(db, tournament.id, current_user.id)
            if wants(requested, CUSTOM)
            else []
        ),
    )
    data = resp.model_dump(mode="json", exclude=dump_exclude(requested))
    return JSONResponse(gate_age_flags(membership, data))


def _resolve_join_code_creators(
    db: Session, tournament_id: int, memberships: list[TournamentMembership], responses: list
):
    """Overwrites each response's .join_code.creator with a properly resolved
    PersonRefResponse. Automatic from_attributes validation would otherwise
    read JoinCode.creator (a plain User relationship), which knows nothing of
    the creator's membership here and so would never carry their roles —
    same fix already applied to JoinCodeResponse.creator and
    AuditLogEntry.actor."""
    creator_ids = {m.join_code.created_by for m in memberships if m.join_code is not None}
    if not creator_ids:
        return
    creators = resolve_person_refs(db, tournament_id, creator_ids)
    for m, resp in zip(memberships, responses, strict=True):
        if m.join_code is not None:
            resp.join_code.creator = creators[m.join_code.created_by]


# Routes nested: /tournaments/{tournament_id}/members/...
router = APIRouter(prefix="/tournaments/{tournament_id}/members", tags=["tournaments"])


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/members/ — manage_members
#
# The one read of many memberships. The members-page roster, the roles
# editor's member list and its add-members picker are all this route with
# different query params — searching is not a different kind of read, and the
# separate /search/ route that used to exist only because the roster returned
# too much is gone now that `fields` says how much to return.
#
# Tournaments are small enough (rarely 150+ members) to return the full
# filtered list rather than paginating.
#
# `surface` names which display_config surface to render for — the members
# table passes "members_table", which both filters hidden items and decides
# which optional column data to load (age, shirt size, availability, lunch,
# custom answers). Omitted means no filtering and no enrichment, so a caller
# with no opinion gets the plain roster, same as the detail route's param.
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[MembershipFullResponse])
def list_memberships(
    tournament_id: int,
    surface: str | None = Query(default=None),
    # Which field groups to serialize. Omitted means everything; `surface`
    # fills in for it when absent (see resolve_fields).
    requested: frozenset[str] | None = Depends(field_selection),
    # Roster filters. Repeatable; different filters AND, values within one OR.
    # The paired ones ("2:confirmed", "protein:Sofritas", "2027-02-13:47")
    # keep the two halves together on purpose, and take "__any__" on the
    # right for "any status / any shift that day / answered at all" — see
    # apply_member_filters.
    role: list[str] = Query(default=[]),
    track: list[str] = Query(default=[]),
    lunch: list[str] = Query(default=[]),
    event_pref: list[str] = Query(default=[]),
    competition_event: list[int] = Query(default=[]),
    volunteer_event: list[int] = Query(default=[]),
    age: list[str] = Query(default=[]),
    shift: list[str] = Query(default=[]),
    # "trackId:assigned|unassigned" — staffed on that track or not.
    assigned: list[str] = Query(default=[]),
    # A school's short name or an employer, as the column shows it; and
    # "1".."5", "graduate", "non_student".
    affiliation: list[str] = Query(default=[]),
    year_level: list[str] = Query(default=[]),
    # "not_started", "in_progress", "complete".
    onboarding: list[str] = Query(default=[]),
    # Identity/authority narrowing — what the role-assignment pickers ask for.
    # A picker is this roster with a name search and a role bound on it, not a
    # different kind of read, so it is the same route.
    q: str | None = Query(default=None),
    role_id: int | None = Query(default=None),
    exclude_role_id: int | None = Query(default=None),
    max_rank: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    tournament = get_tournament(tournament_id, db)
    # The viewer's own config decides both what a surface implies about
    # `fields` and what to drop from each row — see viewer_display_config.
    config = viewer_display_config(db, tournament_id, current_user.id)
    requested = resolve_fields(requested, config, surface)

    query = (
        db.query(TournamentMembership)
        .options(
            # Always: the row has to be able to name who it is about.
            joinedload(TournamentMembership.user),
            *loader_options(requested),
        )
        .filter(TournamentMembership.tournament_id == tournament_id)
    )
    query = apply_member_filters(
        query,
        tournament=tournament,
        roles=role,
        tracks=track,
        lunch=lunch,
        event_preferences=event_pref,
        competition_events=competition_event,
        volunteer_events=volunteer_event,
        age_flags=age,
        shifts=shift,
        assigned=assigned,
        affiliations=affiliation,
        year_levels=year_level,
    )
    query = apply_member_search(
        query,
        db,
        q=q,
        role_id=role_id,
        exclude_role_id=exclude_role_id,
        max_rank=max_rank,
    )
    memberships = query.order_by(TournamentMembership.id).all()
    # Age flags and onboarding are derived, not stored, so they can't be part
    # of the query.
    memberships = filter_age_flags(memberships, age)
    memberships = filter_onboarding(db, tournament_id, memberships, onboarding)
    responses = [MembershipFullResponse.model_validate(m) for m in memberships]
    if wants(requested, MEMBERSHIP):
        _resolve_join_code_creators(db, tournament_id, memberships, responses)
    enrich_built_groups(db, tournament, requested, memberships, responses)
    # gate_age_flags per row, exactly as the detail route does: asking for the
    # age group must never override a member's withheld consent.
    exclude = dump_exclude(requested)
    data = [
        apply_display_config(
            config,
            surface,
            gate_age_flags(membership, resp.model_dump(mode="json", exclude=exclude)),
        )
        for membership, resp in zip(memberships, responses, strict=True)
    ]
    return JSONResponse(data)


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/members/filter-options/ — manage_members
# The values the roster's filter modal can offer, derived from what this
# tournament actually holds. Registered before "/{membership_id}/" so the
# literal path wins.
# ---------------------------------------------------------------------------
@router.get("/filter-options/")
def get_member_filter_options(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    tournament = get_tournament(tournament_id, db)
    return build_filter_options(db, tournament)


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/members/summary/ — manage_members
# The overview's members widget. Its own route rather than a roster param:
# it returns counts, not memberships, so it shares no shape with GET /members/.
# Registered before "/{membership_id}/" so the literal path wins.
# ---------------------------------------------------------------------------
@router.get("/summary/", response_model=MemberSummaryResponse)
def get_member_summary(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    tournament = get_tournament(tournament_id, db)
    return build_member_summary(db, tournament)


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/members/me/ — any member
# Registered before "/{membership_id}/" so the literal path wins.
# ---------------------------------------------------------------------------
@router.get("/me/", response_model=MembershipMeResponse)
def get_my_membership(
    tournament_id: int,
    # Which field groups to serialize. Omitted means everything; `surface`
    # fills in for it when absent (see resolve_fields).
    requested: frozenset[str] | None = Depends(field_selection),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Not require_membership(): a non-member, including a site admin with no
    # row, gets back id=None rather than a 404.
    tournament = get_tournament(tournament_id, db)

    membership = get_membership_by_user(
        db,
        tournament_id,
        current_user.id,
        # The role rides along on each assignment via its own lazy="joined".
        selectinload(TournamentMembership.track_assignments),
    )
    if not membership:
        return _no_membership_response(db, tournament, current_user, requested)

    return _build_me_response(db, tournament, membership, current_user, requested)


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/members/me/age-disclosure/ — self-service
# ---------------------------------------------------------------------------
@router.post("/me/age-disclosure/", response_model=MembershipMeResponse)
def set_my_age_disclosure(
    tournament_id: int,
    payload: AgeDisclosureRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Answer the tournament's age-disclosure prompt. Declining removes you from
    the tournament along with your form responses there; rejoining takes a new
    join link. The owner can't decline."""
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    membership = get_membership_by_user(
        db,
        tournament_id,
        current_user.id,
        # The role rides along on each assignment via its own lazy="joined".
        selectinload(TournamentMembership.track_assignments),
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")

    if not payload.consent:
        if tournament.owner_id == current_user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The tournament owner can't decline age disclosure.",
            )
        delete_tournament_form_responses(db, tournament_id, current_user.id)
        db.delete(membership)
        db.commit()
        return _no_membership_response(db, tournament, current_user)

    membership.age_disclosure = "consented"
    membership.age_disclosure_at = datetime.now(UTC)
    db.commit()
    db.refresh(membership)

    return _build_me_response(db, tournament, membership, current_user)


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/members/{membership_id} — manage_members
#
# One rule, no exceptions: without manage_members (or tournament ownership,
# which grants it) you cannot read anyone's row here, including your own.
# Your own row has its own route — GET .../members/me/ — which returns the
# same membership data plus what you may do in this tournament.
#
# This used to allow self-access and then redact `notes` and the join code
# creator's roles from an already-built response. Two audiences on one route
# meant every field added had to be re-reasoned about for the weaker one; a
# route per audience means the permission check is the whole answer.
# ---------------------------------------------------------------------------
@router.get("/{membership_id}/", response_model=MembershipFullResponse)
def get_membership(
    tournament_id: int,
    membership_id: int,
    surface: str | None = Query(default=None),
    # Which field groups to serialize. Omitted means everything; `surface`
    # fills in for it when absent (see resolve_fields).
    requested: frozenset[str] | None = Depends(field_selection),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(MANAGE_MEMBERS)),
):
    get_tournament(tournament_id, db)
    m = get_scoped_or_404(db, TournamentMembership, membership_id, tournament_id, "Membership")

    config = viewer_display_config(db, tournament_id, current_user.id)
    requested = resolve_fields(requested, config, surface)

    resp = MembershipFullResponse.model_validate(m)
    # Built groups only — the rest came off the ORM. Unlike the roster these
    # run per membership by definition; there is only one.
    if wants(requested, CUSTOM):
        resp.custom_responses = get_custom_form_answers(db, tournament_id, m.user_id)
    if wants(requested, EVENT_PREFS):
        resp.event_preferences = build_event_preferences(db, m)
    if wants(requested, LUNCH):
        resp.lunch = build_lunch(db, m)
    if wants(requested, TRACKS):
        resp.track_statuses = build_track_statuses(db, m)
    if wants(requested, MEMBERSHIP):
        _resolve_join_code_creators(db, tournament_id, [m], [resp])
    if wants(requested, ONBOARDING):
        resp.onboarding = onboarding_reads(db, tournament_id, [m])[0]
    data = gate_age_flags(m, resp.model_dump(mode="json", exclude=dump_exclude(requested)))
    data = apply_display_config(config, surface, data)
    return JSONResponse(data)


# ---------------------------------------------------------------------------
# PATCH /tournaments/{tournament_id}/members/{membership_id} — manage_members (rank-bound)
# Staff override — day-of logistics only (notes). Onboarding data has no
# write path here at all: it comes through the form write-through flow.
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
    resp.event_preferences = build_event_preferences(db, m)
    resp.lunch = build_lunch(db, m)
    resp.track_statuses = build_track_statuses(db, m)
    return JSONResponse(gate_age_flags(m, resp.model_dump(mode="json")))


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/members/me/ — self-service
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
    require_not_archived(tournament)

    if tournament.owner_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transfer ownership before leaving this tournament.",
        )

    m = get_membership_by_user(db, tournament_id, current_user.id)
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")

    delete_tournament_form_responses(db, tournament_id, m.user_id)
    db.delete(m)
    db.commit()


# ---------------------------------------------------------------------------
# DELETE /tournaments/{tournament_id}/members/{membership_id} — manage_members (rank-bound)
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

    # Their answers to this tournament's forms go with them — see
    # delete_tournament_form_responses for why the cascade can't do it.
    delete_tournament_form_responses(db, tournament_id, m.user_id)
    db.delete(m)
    db.commit()
