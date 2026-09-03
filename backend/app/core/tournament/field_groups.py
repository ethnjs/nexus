"""Named field groups for the membership read routes' `fields` query param.

One route serves the roster, the role pickers, the detail panel and the
member's own row. They want wildly different amounts of the same membership,
and the old answer was a second response schema (MembershipSlimResponse) plus
a second route (GET .../search/). This is the replacement: the caller names
the groups it wants and gets exactly those.

Three rules the rest of the system depends on:

1. **Omitting `fields` means everything.** parse_fields returns None for an
   absent param, and every consumer treats None as "no narrowing". A caller
   with no opinion is never punished with a surprise-empty response.

2. **An unrequested group is absent from the JSON, not null.** `null` and `[]`
   keep their ordinary meanings — no value, and no rows. "You didn't ask" is a
   missing key. A client can therefore never mistake a withheld field for an
   empty one.

3. **Identity is not a group.** id/created_at/the member's name and so on
   always serialize. `fields` selects membership *data*; it does not let a
   caller ask for a row it can't identify, and there is no caller that wants
   one.

Groups also carry their loading strategy, which is the actual performance
win. A group nobody asked for gets noload() rather than being fetched and
thrown away — pydantic validates straight off the ORM object, so a
relationship left on its default lazy strategy would issue a query per row
for data that is about to be excluded from the dump anyway.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.orm import joinedload, noload, selectinload


# ---------------------------------------------------------------------------
# Always-present keys — see rule 3 above.
#
# The nested user object keeps its name, pronouns and account timestamps: no
# caller wants an anonymous row, and account_age is a default members-table
# column whose data is already on the joined User row, so grouping it would
# force the table to pull the whole profile for one scalar.
# ---------------------------------------------------------------------------
ALWAYS_KEYS = frozenset({
    # MembershipFullResponse
    "id", "tournament_id", "created_at", "updated_at", "user",
    # MembershipMeResponse — who the caller is here and what they may do.
    "membership_id", "is_owner", "permissions", "needs_age_consent",
    # Set by apply_display_config, not by fields — see the note on
    # MembershipFullResponse.hidden_sections.
    "hidden_sections",
})

ALWAYS_USER_KEYS = frozenset({
    "id", "first_name", "last_name", "pronouns", "created_at", "updated_at",
})


@dataclass(frozen=True)
class FieldGroup:
    """One name a caller can put in `fields`.

    `keys`/`user_keys` are what it serializes. `relationships` are the
    TournamentMembership relationship attributes it reads — loaded eagerly
    when the group is wanted, noload()ed when it isn't. `user_relationships`
    is the same for hops off the joined User.

    `built` marks a group whose raw ORM rows are not its final value: a
    builder in app.core.tournament.memberships has to run, because the shape
    the client needs can only be recovered from the tournament's forms. Those
    builders still read the relationship (and so still need it loaded) —
    build_event_preferences reverses one-row-per-event back into the option
    the member actually picked, build_lunch resolves each row's
    question_type. custom is the one built group with no relationship at all.
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

GROUPS: dict[str, FieldGroup] = {
    CONTACT: FieldGroup(
        name=CONTACT,
        user_keys=frozenset({"email", "phone"}),
    ),
    # The expensive one: two collections and a join off User. A role picker
    # asking for contact must not pay for this.
    PROFILE: FieldGroup(
        name=PROFILE,
        user_keys=frozenset({
            "student_status", "university", "major", "year_level",
            "graduation_year", "employer", "has_competition_experience",
            "has_volunteer_experience", "competition_experience",
            "volunteer_experience", "shirt_size", "dietary_restriction",
        }),
        user_relationships=("competition_experience", "volunteer_experience", "university"),
    ),
    ROLES: FieldGroup(
        name=ROLES,
        keys=frozenset({"roles"}),
        relationships=("roles",),
    ),
    # How they got here: source, the code they used, and whether they have
    # answered the age prompt. Staff provenance, absent from the Me response.
    MEMBERSHIP: FieldGroup(
        name=MEMBERSHIP,
        keys=frozenset({"source", "join_code", "age_disclosure"}),
        relationships=("join_code",),
    ),
    # Not `built`: the raw rows are the right answer for a manager reading
    # the roster. /members/me additionally pads every live track the member
    # has no row for as "pending" (build_track_statuses), because those are
    # exactly the tracks its self-service control needs to offer — that is a
    # property of the route, not of the group.
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
    # The relationship holds one flat row per event; only build_event_
    # preferences can group them back into the option the member picked, so
    # MembershipBaseResponse's validator drops the raw rows outright.
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
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
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
    """The `exclude` argument for model_dump — the keys of every group the
    caller did not ask for.

    Returns None when nothing is excluded, so callers can pass it straight
    through to model_dump(exclude=...) either way.

    Shaped as a dict because the user object is split across groups: contact
    and profile prune keys inside it while the object itself always
    serializes. Keys belonging to a schema that doesn't have them (notes on
    the Me response, say) are harmless — pydantic ignores an exclude entry
    for a field the model doesn't declare, which is what lets one exclude set
    serve both response models.
    """
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
    """SQLAlchemy options implementing `fields` at the query level.

    A wanted relationship is loaded eagerly (one query for the whole page
    rather than one per row); an unwanted one is noload()ed so that pydantic
    validating off the ORM object sees an empty collection and never touches
    the database for a field that is about to be excluded anyway.

    Deliberately does NOT emit the joins every response needs regardless —
    the user row itself, mainly. Routes add those; this only expresses what
    varies with `fields`.
    """
    from app.models.models import (
        TournamentMembership, TournamentMembershipAvailability,
        TournamentMembershipRole, User,
    )

    # Relationships needing a further hop to be usable: the role behind a
    # membership-role join row, the shift behind an availability row.
    NESTED = {
        "roles": joinedload(TournamentMembershipRole.role),
        "availability_shifts": joinedload(TournamentMembershipAvailability.tournament_shift),
    }

    options = []
    for name, group in GROUPS.items():
        included = wants(requested, name)
        for rel in group.relationships:
            attr = getattr(TournamentMembership, rel)
            if not included:
                options.append(noload(attr))
                continue
            option = selectinload(attr)
            nested = NESTED.get(rel)
            options.append(option.options(nested) if nested is not None else option)

        for rel in group.user_relationships:
            attr = getattr(User, rel)
            # Chained off joinedload(user), which every route already
            # applies: two strategies for one path is an InvalidRequestError,
            # so the chain has to agree with the bare option above it.
            base = joinedload(TournamentMembership.user)
            options.append(base.selectinload(attr) if included else base.noload(attr))

    return options
