from __future__ import annotations
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, noload, selectinload
from app.core.auth import get_current_user
from app.core.tournament import get_scoped_or_404, get_tournament, require_not_archived
from app.core.tournament.display_config import (
    apply_display_config, viewer_display_config,
)
from app.core.tournament.member_filters import (
    apply_member_filters, apply_member_search, build_filter_options, filter_age_flags,
)
from app.core.tournament.field_groups import (
    AVAILABILITY, CUSTOM, EVENT_PREFS, LUNCH, MEMBERSHIP, ROLES, TRACKS,
    dump_exclude, field_selection, loader_options, resolve_fields, wants,
)
from app.core.tournament.memberships import (
    ACTIVE_MEMBERSHIP_CLAUSE, build_event_preferences, build_lunch, build_track_statuses,
    delete_tournament_form_responses, enrich_built_groups, gate_age_flags,
    get_custom_form_answers, get_membership_by_user, resolve_person_refs,
)
from app.core.tournament.permissions import (
    MANAGE_MEMBERS, get_user_permissions, require_permission,
)
from app.core.tournament.roles import validate_member_target
from app.db.session import get_db
from app.core.form.member_options import member_editable_reserved_fields, member_track_options
from app.core.form.validation import (
    LUNCH_FREE_TEXT_QUESTION_TYPES, event_preference_field_track_id, lunch_field_track_id,
)
from app.core.form.write_through import (
    event_preference_items_from_answer, lunch_values_from_answer, shift_ids_on_tracks,
    sync_availability, sync_event_preferences, sync_lunch,
)
from app.models.models import (
    Tournament,
    TournamentMembership,
    TournamentMembershipRole,
    TournamentMembershipTrackStatus,
    TournamentRole,
    TournamentShift,
    TournamentTrack,
    User,
)
from app.schemas.tournament.membership import (
    AgeDisclosureRequest, MembershipAvailabilityRead, MembershipAvailabilityUpdate,
    MembershipCoordinatorUpdate, MembershipEventPreferenceUpdate, MembershipFullResponse,
    MembershipLunchRead,
    MembershipLunchUpdate, MembershipMeResponse, MembershipTrackStatusUpdate,
)
from app.schemas.tournament.track import MembershipTrackStatusRead


def _build_me_response(
    db: Session, tournament: Tournament, membership: TournamentMembership, current_user: User,
    requested: frozenset[str] | None = None,
) -> JSONResponse:
    """Shared by GET .../me/ and POST .../me/age-disclosure/ — both return
    the same shape for the caller's own membership.

    Every builder below is a query, and this route runs on every dashboard
    page load (MyMembershipProvider wraps the whole tournament section), so
    `requested` gating them is not a micro-optimisation: the provider reads
    four identity fields and nothing else, and says so with fields=roles.
    """
    permissions = sorted(get_user_permissions(current_user, tournament.id, db))
    is_owner = current_user.id == tournament.owner_id
    needs_age_consent = (
        (tournament.collect_is_over_18 or tournament.collect_is_over_21)
        and membership.age_disclosure is None
    )
    resp = MembershipMeResponse(
        id=membership.id, created_at=membership.created_at,
        updated_at=membership.updated_at, user=membership.user,
        is_owner=is_owner, permissions=permissions,
        needs_age_consent=needs_age_consent,
        roles=membership.roles if wants(requested, ROLES) else [],
        is_over_18=membership.is_over_18, is_over_21=membership.is_over_21,
        # build_track_statuses rather than the raw rows: it pads every live
        # track the member has no row for as "pending", and those are exactly
        # the tracks a self-service control needs to offer.
        track_statuses=build_track_statuses(db, membership) if wants(requested, TRACKS) else [],
        event_preferences=build_event_preferences(db, membership) if wants(requested, EVENT_PREFS) else [],
        availability=[
            MembershipAvailabilityRead.from_row(row, tournament)
            for row in membership.availability_shifts
        ] if wants(requested, AVAILABILITY) else [],
        lunch=build_lunch(db, membership) if wants(requested, LUNCH) else [],
        custom_responses=(
            get_custom_form_answers(db, tournament.id, current_user.id)
            if wants(requested, CUSTOM) else []
        ),
    )
    data = resp.model_dump(mode="json", exclude=dump_exclude(requested))
    return JSONResponse(gate_age_flags(membership, data))


def _resolve_join_code_creators(db: Session, tournament_id: int, memberships: list[TournamentMembership], responses: list):
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
    for m, resp in zip(memberships, responses):
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
    include_declined: bool = Query(False),
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
    if not include_declined:
        query = query.filter(ACTIVE_MEMBERSHIP_CLAUSE)
    query = apply_member_filters(
        query,
        tournament=tournament,
        roles=role, tracks=track, lunch=lunch, event_preferences=event_pref,
        competition_events=competition_event, volunteer_events=volunteer_event,
        age_flags=age, shifts=shift,
    )
    query = apply_member_search(
        query, db,
        q=q, role_id=role_id, exclude_role_id=exclude_role_id, max_rank=max_rank,
    )
    memberships = query.order_by(TournamentMembership.id).all()
    # Age flags are derived, not stored, so they can't be part of the query.
    memberships = filter_age_flags(memberships, age)
    responses = [MembershipFullResponse.model_validate(m) for m in memberships]
    if wants(requested, MEMBERSHIP):
        _resolve_join_code_creators(db, tournament_id, memberships, responses)
    enrich_built_groups(db, tournament, requested, memberships, responses)
    # gate_age_flags per row, exactly as the detail route does: asking for the
    # age group must never override a member's withheld consent.
    exclude = dump_exclude(requested)
    data = [
        apply_display_config(
            config, surface,
            gate_age_flags(membership, resp.model_dump(mode="json", exclude=exclude)),
            tournament,
        )
        for membership, resp in zip(memberships, responses)
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
        # No id/user either — there is no membership to describe.
        resp = MembershipMeResponse(
            is_owner=is_owner, roles=[], permissions=permissions,
        )
        data = resp.model_dump(mode="json", exclude=dump_exclude(requested))
        return JSONResponse(gate_age_flags(None, data))

    return _build_me_response(db, tournament, membership, current_user, requested)


# ---------------------------------------------------------------------------
# POST /tournaments/{tournament_id}/members/me/age-disclosure/ — self-service
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
    tournament = get_tournament(tournament_id, db)
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
    data = gate_age_flags(m, resp.model_dump(mode="json", exclude=dump_exclude(requested)))
    data = apply_display_config(config, surface, data, tournament)
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


def _my_membership(db: Session, tournament_id: int, current_user: User) -> TournamentMembership:
    m = get_membership_by_user(db, tournament_id, current_user.id)
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")
    return m


def _live_track(db: Session, tournament_id: int, track_id: int) -> TournamentTrack:
    """A track the member may still answer about. A pending-delete track is
    on its way out; inviting an answer to it would be inviting them to act on
    something whose rows are about to be cascaded away."""
    track = get_scoped_or_404(db, TournamentTrack, track_id, tournament_id, "Track")
    if track.is_archived:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This track is pending deletion",
        )
    return track


def _set_track_status(db: Session, membership_id: int, track: TournamentTrack, incoming: str) -> None:
    """The self-service status write, shared by the status route and the
    availability route (whose "Not available" clears shifts and declines in
    one call). The transition rules live in backend/track-status-rules.md."""
    if incoming == "confirmed" and not track.allow_confirm:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This track's confirmation is not open yet",
        )
    if incoming == "interested" and track.allow_confirm:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Confirm or decline this track — there's no interested step on it",
        )

    row = (
        db.query(TournamentMembershipTrackStatus)
        .filter(
            TournamentMembershipTrackStatus.membership_id == membership_id,
            TournamentMembershipTrackStatus.track_id == track.id,
        )
        .first()
    )
    if row is None:
        db.add(TournamentMembershipTrackStatus(
            membership_id=membership_id, track_id=track.id, status=incoming,
        ))
    else:
        row.status = incoming


# ---------------------------------------------------------------------------
# GET /tournaments/{tournament_id}/members/me/options/ — self-service catalog
#
# What this member may change about themselves, per track: the live questions
# their tournament asks, with options resolved to real shifts and events, and
# their current answers alongside. One request backs the whole edit page.
#
# Only *live* questions on *published* forms appear. That is stricter than the
# read builders, which deliberately consult archived fields so an old answer
# still renders — reading history and offering a choice are different things.
# ---------------------------------------------------------------------------
@router.get("/me/options/")
def get_my_options(
    tournament_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_tournament(tournament_id, db)
    m = _my_membership(db, tournament_id, current_user)
    return {"tracks": member_track_options(db, tournament_id, m)}


# ---------------------------------------------------------------------------
# PUT /tournaments/{tournament_id}/members/me/availability/{track_id}/
#
# The member's own availability for one track, edited from their member page
# rather than through a form. Forms remain an input channel that writes the
# same rows (see core/form/write_through.py); this is a second writer, not a
# replacement, which is why it reuses that module's diff instead of rewriting
# the set: an unchanged shift keeps its row.
#
# Whole-set within the track: the page shows that track's groups all at once,
# so anything left out is a withdrawal rather than a question that wasn't
# asked. Scoped to the track and not the tournament because the page is laid
# out per track — saving Day 1 must not touch Day 2.
# ---------------------------------------------------------------------------
@router.put("/me/availability/{track_id}/", response_model=list[MembershipAvailabilityRead])
def update_my_availability(
    tournament_id: int,
    track_id: int,
    payload: MembershipAvailabilityUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    m = _my_membership(db, tournament_id, current_user)
    track = _live_track(db, tournament_id, track_id)

    owned_shift_ids = shift_ids_on_tracks(db, tournament_id, {track_id})
    unknown = set(payload.shift_ids) - owned_shift_ids
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Shift {sorted(unknown)[0]} is not on this track",
        )

    sync_availability(db, m.id, set(payload.shift_ids), owned_shift_ids)
    if payload.status is not None:
        _set_track_status(db, m.id, track, payload.status)
    db.commit()
    db.refresh(m)
    return [MembershipAvailabilityRead.from_row(row) for row in m.availability_shifts]


# ---------------------------------------------------------------------------
# PUT /tournaments/{tournament_id}/members/me/lunch/{track_id}/{category}/
#
# (track, category) is exactly the unit sync_lunch is scoped to, so this can
# never disturb another category or another track's answer to the same one.
# ---------------------------------------------------------------------------
@router.put("/me/lunch/{track_id}/{category}/", response_model=list[MembershipLunchRead])
def update_my_lunch(
    tournament_id: int,
    track_id: int,
    category: str,
    payload: MembershipLunchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    m = _my_membership(db, tournament_id, current_user)
    _live_track(db, tournament_id, track_id)

    field = next(
        (
            f for f in member_editable_reserved_fields(db, tournament_id)
            if f.field_key == f"lunch_{track_id}_{category}"
        ),
        None,
    )
    if field is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No live question covers this track's lunch category",
        )

    free_text = field.question_type in LUNCH_FREE_TEXT_QUESTION_TYPES
    if free_text and payload.option_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This is a free-text question — send `text`, not `option_ids`",
        )
    if not free_text and payload.text is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This question has options — send `option_ids`, not `text`",
        )
    if field.question_type == "single_select_radio" and len(payload.option_ids) > 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only one option may be selected on this question",
        )

    live_option_ids = {
        option["option_id"]
        for option in (field.config or {}).get("options", [])
        if not option.get("is_archived")
    }
    unknown = set(payload.option_ids) - live_option_ids
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown option {sorted(unknown)[0]}",
        )

    answer = payload.text if free_text else payload.option_ids
    sync_lunch(db, m.id, track_id, category, lunch_values_from_answer(field, answer))
    db.commit()
    db.refresh(m)
    return build_lunch(db, m)


# ---------------------------------------------------------------------------
# PUT /tournaments/{tournament_id}/members/me/event-preferences/{track_id}/
#
# Whole-set for the track. A track has exactly one preference question, so it
# owns its rows outright and a replace can't damage anything else.
# ---------------------------------------------------------------------------
@router.put("/me/event-preferences/{track_id}/")
def update_my_event_preferences(
    tournament_id: int,
    track_id: int,
    payload: MembershipEventPreferenceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)
    m = _my_membership(db, tournament_id, current_user)
    _live_track(db, tournament_id, track_id)

    field = next(
        (
            f for f in member_editable_reserved_fields(db, tournament_id)
            if event_preference_field_track_id(f.field_key) == track_id
        ),
        None,
    )
    if field is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No live question covers this track's event preferences",
        )

    live_option_ids = {
        option["option_id"]
        for option in (field.config or {}).get("options", [])
        if not option.get("is_archived")
    }
    option_ids = [sel.option_id for sel in payload.selections]
    unknown = set(option_ids) - live_option_ids
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown option {sorted(unknown)[0]}",
        )
    if len(set(option_ids)) != len(option_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="An option may only be selected once",
        )

    if field.question_type == "ranked_choice":
        ranks = [sel.rank for sel in payload.selections]
        if any(rank is None for rank in ranks):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Every selection on a ranked question needs a rank",
            )
        # Contiguous from 1: a gap or a repeat has no meaning a reader could
        # act on, and the stored rows carry no record of which it was.
        if sorted(ranks) != list(range(1, len(ranks) + 1)):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Ranks must be unique and contiguous, starting at 1",
            )
        max_ranks = (field.config or {}).get("ranks")
        if max_ranks is not None and len(ranks) > max_ranks:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"At most {max_ranks} option(s) may be ranked",
            )
        answer = {str(sel.rank): sel.option_id for sel in payload.selections}
    else:
        if any(sel.rank is not None for sel in payload.selections):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="This question is not ranked — omit `rank`",
            )
        if field.question_type == "single_select_dropdown" and len(option_ids) > 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Only one option may be selected on this question",
            )
        answer = option_ids

    sync_event_preferences(
        db, m.id, track_id, event_preference_items_from_answer(field, answer),
    )
    db.commit()
    db.refresh(m)
    return build_event_preferences(db, m)


# ---------------------------------------------------------------------------
# PUT /tournaments/{tournament_id}/members/me/track-statuses/{track_id}/
# — self-service
#
# The three statuses split by who they belong to:
#
#   declined    always — opting out is the member's own call, on any track.
#   confirmed   only with the track's allow_confirm. Otherwise
#               `confirmed` means the TD staffed them, and only the TD knows.
#   interested  only *without* allow_confirm — it's the way back in for
#               a member who can't confirm themselves. With self-confirm on,
#               declined goes straight to confirmed and the middle state
#               would be a step to nowhere.
#
# Coming back from `declined` at all is something write-through refuses (see
# can_set_track_status). That guard exists to stop a *stale form write* from
# demoting a track a newer form already advanced — a member acting on their
# own page is neither stale nor out of order, and without this exception a
# mistaken opt-out would be a one-way door.
# ---------------------------------------------------------------------------
@router.put("/me/track-statuses/{track_id}/", response_model=MembershipTrackStatusRead)
def update_my_track_status(
    tournament_id: int,
    track_id: int,
    payload: MembershipTrackStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tournament = get_tournament(tournament_id, db)
    require_not_archived(tournament)

    m = get_membership_by_user(db, tournament_id, current_user.id)
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")

    track = _live_track(db, tournament_id, track_id)
    _set_track_status(db, m.id, track, payload.status)
    db.commit()

    row = (
        db.query(TournamentMembershipTrackStatus)
        .filter(
            TournamentMembershipTrackStatus.membership_id == m.id,
            TournamentMembershipTrackStatus.track_id == track_id,
        )
        .one()
    )
    return MembershipTrackStatusRead.from_row(row)


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
