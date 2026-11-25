"""Named field groups for the membership read routes' `fields` query param.

The roster, the role pickers, the detail panel, and /members/me read the same
membership in very different amounts; a caller names the groups it wants and
gets exactly those. Three rules the rest of the system depends on:

1. **Omitting `fields` means everything.** parse_fields returns None for an
   absent param, and every consumer treats None as "no narrowing".

2. **An unrequested group is absent from the JSON, not null.** `null` and
   `[]` keep their ordinary meanings, so a client can never mistake a
   withheld field for an empty one.

3. **Identity is not a group.** id, created_at, the member's name and so on
   always serialize.

An unrequested group costs no query: loader_options raiseloads its
relationships and validate_requested never reads its fields.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Query, status
from sqlalchemy.orm import joinedload, raiseload, selectinload

# Always-present keys (rule 3). The nested user keeps its name, pronouns and
# account timestamps: account_age is a default members-table column, and its
# data is already on the joined User row.
ALWAYS_KEYS = frozenset(
    {
        # Which membership this is, on both responses. Null on /members/me only
        # when the caller has no membership row at all.
        "id",
        "created_at",
        "updated_at",
        "user",
        "tournament_id",
        # MembershipMeResponse — who the caller is here and what they may do.
        "is_owner",
        "permissions",
        "needs_age_consent",
        "needs_onboarding",
        # Set by apply_display_config, not by fields — see the note on
        # MembershipFullResponse.hidden_sections.
        "hidden_sections",
    }
)

ALWAYS_USER_KEYS = frozenset(
    {
        "id",
        "first_name",
        "last_name",
        "pronouns",
        "created_at",
        "updated_at",
    }
)


@dataclass(frozen=True)
class FieldGroup:
    """One name a caller can put in `fields`.

    `keys`/`user_keys` are what it serializes; `relationships`/
    `user_relationships` are the TournamentMembership/User relationships it
    reads, eager-loaded when wanted and raiseloaded when not. `built` marks a
    group whose final value comes from a builder in
    app.core.tournament.memberships rather than straight off the ORM rows.
    """

    name: str
    keys: frozenset[str] = frozenset()
    user_keys: frozenset[str] = frozenset()
    relationships: tuple[str, ...] = ()
    user_relationships: tuple[str, ...] = ()
    built: bool = False


CONTACT = "contact"
PROFILE = "profile"
ROLES = "roles"
MEMBERSHIP = "membership"
TRACKS = "tracks"
AVAILABILITY = "availability"
LUNCH = "lunch"
EVENT_PREFS = "event_prefs"
CUSTOM = "custom"
NOTES = "notes"
AGE = "age"
ASSIGNMENTS = "assignments"
ONBOARDING = "onboarding"

GROUPS: dict[str, FieldGroup] = {
    CONTACT: FieldGroup(
        name=CONTACT,
        user_keys=frozenset({"email", "phone"}),
    ),
    # The expensive one: two collections and a join off User. A role picker
    # asking for contact must not pay for this.
    PROFILE: FieldGroup(
        name=PROFILE,
        user_keys=frozenset(
            {
                "student_status",
                "university",
                "major",
                "year_level",
                "graduation_year",
                "employer",
                "has_competition_experience",
                "has_volunteer_experience",
                "competition_experience",
                "volunteer_experience",
                "tournament_memberships",
                "shirt_size",
                "dietary_restriction",
            }
        ),
        user_relationships=(
            "competition_experience",
            "volunteer_experience",
            "university",
            "memberships",
        ),
    ),
    # Serialized as roles but loaded through track_assignments: a member's roles
    # are the distinct roles across those rows.
    ROLES: FieldGroup(
        name=ROLES,
        keys=frozenset({"roles"}),
        relationships=("track_assignments",),
    ),
    # How they got here: source, the code they used, and whether they have
    # answered the age prompt. Staff provenance, absent from the Me response.
    MEMBERSHIP: FieldGroup(
        name=MEMBERSHIP,
        keys=frozenset({"source", "join_code", "age_disclosure"}),
        relationships=("join_code",),
    ),
    # Not built: the raw rows are what a manager's roster shows. /members/me pads
    # untouched live tracks as "pending" itself (build_track_statuses).
    TRACKS: FieldGroup(
        name=TRACKS,
        keys=frozenset({"track_statuses"}),
        relationships=("track_statuses",),
    ),
    AVAILABILITY: FieldGroup(
        name=AVAILABILITY,
        keys=frozenset({"availability"}),
        relationships=("availability_shifts",),
    ),
    LUNCH: FieldGroup(
        name=LUNCH,
        keys=frozenset({"lunch"}),
        relationships=("lunch_selections",),
        built=True,
    ),
    # One flat row per event; only build_event_preferences can regroup them by
    # the option picked, so the schema drops the raw rows.
    EVENT_PREFS: FieldGroup(
        name=EVENT_PREFS,
        keys=frozenset({"event_preferences"}),
        relationships=("event_preferences",),
        built=True,
    ),
    # No relationship at all — get_custom_form_answers runs a cross-model
    # query against the tournament's form responses.
    CUSTOM: FieldGroup(
        name=CUSTOM,
        keys=frozenset({"custom_responses"}),
        built=True,
    ),
    NOTES: FieldGroup(
        name=NOTES,
        keys=frozenset({"notes"}),
    ),
    # Derived from date_of_birth, never stored, and gated a second time by
    # gate_age_flags — asking for the group is not consent to see it.
    AGE: FieldGroup(
        name=AGE,
        keys=frozenset({"is_over_18", "is_over_21"}),
    ),
    # What this member is staffing. Declared on MembershipFullResponse only —
    # the Me response doesn't carry it, so asking for this group on /members/me
    # narrows nothing rather than leaking assignments to the member.
    ASSIGNMENTS: FieldGroup(
        name=ASSIGNMENTS,
        keys=frozenset({"assignments"}),
        relationships=("assignments",),
    ),
    # How far through the live onboarding sequence this member is. Built from
    # form responses (no relationship), and manager-only like assignments.
    ONBOARDING: FieldGroup(
        name=ONBOARDING,
        keys=frozenset({"onboarding"}),
        built=True,
    ),
}

ALL_GROUPS = frozenset(GROUPS)


def parse_fields(raw: str | None) -> frozenset[str] | None:
    """Parse the `fields` query param.

    None (param absent) means everything — see rule 1. An empty or
    whitespace-only string is a real answer, not an absent one: it means the
    caller wants identity and nothing else, which is what /join's
    "am I already a member?" check needs.

    Unknown names 422 rather than being ignored, so a typo surfaces as a
    failed request instead of a silently missing section.
    """
    if raw is None:
        return None
    names = [part.strip() for part in raw.split(",")]
    requested = {name for name in names if name}
    unknown = sorted(requested - ALL_GROUPS)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Unknown field group(s): {', '.join(unknown)}. "
                f"Valid groups: {', '.join(sorted(ALL_GROUPS))}."
            ),
        )
    return frozenset(requested)


def wants(requested: frozenset[str] | None, group: str) -> bool:
    """Whether `group` should be included. None means everything."""
    return requested is None or group in requested


def dump_exclude(requested: frozenset[str] | None) -> dict | None:
    """model_dump's `exclude` for every unrequested group, or None when nothing
    is excluded. A dict because contact and profile prune keys inside `user`;
    keys a model doesn't declare are ignored, so one value serves both
    response models and validate_requested."""
    if requested is None:
        return None

    top: set[str] = set()
    user: set[str] = set()
    for name, group in GROUPS.items():
        if name in requested:
            continue
        top |= group.keys
        user |= group.user_keys

    exclude: dict = {key: True for key in top}
    if user:
        exclude["user"] = user
    return exclude or None


def loader_options(requested: frozenset[str] | None) -> list:
    """Loader options implementing `fields`: a wanted relationship is
    eager-loaded for the whole page, an unwanted one raiseloaded. Routes add
    the loads every response needs, such as the user row."""
    from app.core.users import tournament_membership_loads
    from app.models.models import (
        Event,
        TournamentEvent,
        TournamentMembership,
        TournamentMembershipAvailability,
        TournamentTrackAssignment,
        User,
        UserCompetitionExperience,
        UserVolunteerExperience,
    )

    # Further hops a wanted relationship needs: the shift behind an availability
    # row, and the four an AssignmentRead flattens.
    NESTED = {
        # The role rides along on each assignment via its own lazy="joined".
        "track_assignments": (),
        "availability_shifts": (joinedload(TournamentMembershipAvailability.tournament_shift),),
        "assignments": (
            joinedload(TournamentTrackAssignment.tournament_event).joinedload(
                TournamentEvent.event
            ),
            joinedload(TournamentTrackAssignment.tournament_event).selectinload(
                TournamentEvent.shifts
            ),
            joinedload(TournamentTrackAssignment.tournament_shift),
            joinedload(TournamentTrackAssignment.membership).joinedload(TournamentMembership.user),
        ),
    }
    USER_NESTED = {
        "competition_experience": (
            *Event.load_related_events(selectinload(UserCompetitionExperience.event)),
        ),
        "volunteer_experience": (
            *Event.load_related_events(selectinload(UserVolunteerExperience.event)),
        ),
        "memberships": tournament_membership_loads(),
    }

    options = []
    for name, group in GROUPS.items():
        included = wants(requested, name)
        for rel in group.relationships:
            attr = getattr(TournamentMembership, rel)
            if not included:
                options.append(raiseload(attr))
                continue
            option = selectinload(attr)
            nested = NESTED.get(rel)
            options.append(option.options(*nested) if nested is not None else option)

        for rel in group.user_relationships:
            attr = getattr(User, rel)
            # Chained off joinedload(user), which every route already
            # applies: two strategies for one path is an InvalidRequestError,
            # so the chain has to agree with the bare option above it.
            base = joinedload(TournamentMembership.user)
            if not included:
                options.append(base.raiseload(attr))
                continue
            option = base.selectinload(attr)
            nested = USER_NESTED.get(rel)
            options.append(option.options(*nested) if nested else option)

    return options


def field_selection(fields: str | None = Query(default=None)) -> frozenset[str] | None:
    """FastAPI dependency for the `fields` query param.

    Declared here so every route that supports narrowing gets the same
    param name, the same validation and the same Swagger description.
    """
    return parse_fields(fields)


def resolve_fields(
    requested: frozenset[str] | None,
    config: dict | None,
    surface: str | None,
) -> frozenset[str] | None:
    """Reconcile an explicit `fields` with what `surface` implies.

    An explicit `fields` always wins — a caller that named its groups meant
    them, and silently unioning in a surface's groups would make the
    narrowing unpredictable. `surface` only fills in for a caller that
    expressed no preference, which is what lets the members page ask for
    "whatever my saved columns need" without enumerating it.
    """
    from app.core.tournament.display_config import fields_for_surface

    if requested is not None:
        return requested
    return fields_for_surface(config, surface)
