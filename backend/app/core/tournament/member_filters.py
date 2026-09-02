"""Server-side filtering for the members roster.

Every filter here matches against data the roster response does *not* carry —
track statuses at a given status, lunch picks, event preferences, experience,
availability — which is why it can't live in the browser: the client would
have to be sent the whole tournament's onboarding data on every page load to
answer questions about a handful of members.

Two rules across the board:
  * different filters AND together (a role filter and a shift filter both
    have to pass),
  * values within one filter OR together (any of the named roles matches).

Each filter is an EXISTS subquery rather than a join, so a member holding
three of the named roles is returned once, not three times.
"""
from __future__ import annotations

from sqlalchemy import exists, func, or_, true
from sqlalchemy.orm import Query

from app.models.models import (
    TournamentMembership, TournamentMembershipAvailability, TournamentMembershipEventPreference,
    TournamentMembershipLunch, TournamentMembershipRole, TournamentMembershipTrackStatus,
    UserCompetitionExperience, UserVolunteerExperience,
)

# Sentinel accepted in the `role` filter for members holding no roles at all.
# A plain "no roles" is not expressible as a role id, and it's the one members
# a coordinator most often wants to find.
NO_ROLES = "none"

# Right-hand sentinel on every paired filter: the member answered *something*
# for this track/day/category/question. The modal adds a chip for the left
# half first (a track, a day, a lunch category) and only then narrows it, so
# a chip has to mean something before its pill is touched.
ANY = "__any__"

# Lunch-only right-hand sentinels. "Unanswered" is the one thing an EXISTS
# over stored rows can't say by naming a value, and none/not-none exist
# because "no dietary restrictions" is an answer of "none" — a missing row
# means the member never filled the question in, which is a different member.
LUNCH_UNANSWERED = "__unanswered__"
LUNCH_NONE = "__none__"
LUNCH_NOT_NONE = "__not_none__"


def _split_pairs(values: list[str]) -> list[tuple[str, str]]:
    """Parses "left:right" filter values, dropping anything malformed.

    Filter values come off a URL, so a bad one is a client bug or a stale
    bookmark — neither worth failing a roster load over. The alternative
    (422) would leave a TD staring at an error with no way to clear it.
    """
    pairs = []
    for value in values:
        left, sep, right = value.partition(":")
        if sep and left and right:
            pairs.append((left, right))
    return pairs


def _lunch_clause(category: str, value: str):
    """One lunch filter value as an EXISTS (or NOT EXISTS) over this
    membership's lunch rows for `category`.

    A row only exists once the member answered, so "unanswered" is the
    absence of rows — and "none" has to be the stored string, not a missing
    row: someone who wrote "none" has told you they eat anything, someone
    with no row has told you nothing.
    """
    in_category = (
        (TournamentMembershipLunch.membership_id == TournamentMembership.id)
        & (TournamentMembershipLunch.category == category)
    )
    if value == LUNCH_UNANSWERED:
        return ~exists().where(in_category)
    if value == ANY:
        return exists().where(in_category)
    if value == LUNCH_NONE:
        return exists().where(in_category & (func.lower(TournamentMembershipLunch.value) == "none"))
    if value == LUNCH_NOT_NONE:
        return exists().where(in_category & (func.lower(TournamentMembershipLunch.value) != "none"))
    return exists().where(in_category & (TournamentMembershipLunch.value == value))


def _shift_ids_on_days(db, tournament, days: set[str]) -> set[int]:
    """Every shift of `tournament` starting on one of the given ISO days,
    read in the tournament's own timezone (see tournament_local_date)."""
    from app.core.tournament import tournament_local_date
    from app.models.models import TournamentShift

    return {
        shift_id
        for shift_id, start in db.query(TournamentShift.id, TournamentShift.start)
        .filter(TournamentShift.tournament_id == tournament.id)
        if tournament_local_date(tournament, start).isoformat() in days
    }


def apply_member_filters(
    query: Query,
    *,
    tournament=None,
    roles: list[str] | None = None,
    tracks: list[str] | None = None,
    lunch: list[str] | None = None,
    event_preferences: list[str] | None = None,
    competition_events: list[int] | None = None,
    volunteer_events: list[int] | None = None,
    age_flags: list[str] | None = None,
    shifts: list[str] | None = None,
) -> Query:
    """Narrows a TournamentMembership query by the roster's filter params.

    `tournament` is only needed to resolve a day-level availability filter
    ("every shift on Feb 13") into shift ids — a shift's day depends on the
    tournament's timezone, not on UTC."""
    if roles:
        role_ids = [int(value) for value in roles if value != NO_ROLES]
        clauses = []
        if role_ids:
            clauses.append(exists().where(
                (TournamentMembershipRole.membership_id == TournamentMembership.id)
                & TournamentMembershipRole.role_id.in_(role_ids)
            ))
        if NO_ROLES in roles:
            clauses.append(~exists().where(
                TournamentMembershipRole.membership_id == TournamentMembership.id
            ))
        if clauses:
            query = query.filter(or_(*clauses))

    if tracks:
        # "trackId:status" — the pairing is the point. Filtering by track and
        # by status independently would match a member confirmed on one track
        # and declined on another, which is the opposite of what was asked.
        clauses = [
            exists().where(
                (TournamentMembershipTrackStatus.membership_id == TournamentMembership.id)
                & (TournamentMembershipTrackStatus.track_id == int(track_id))
                & (true() if status == ANY else TournamentMembershipTrackStatus.status == status)
            )
            for track_id, status in _split_pairs(tracks)
            if track_id.isdigit()
        ]
        if clauses:
            query = query.filter(or_(*clauses))

    if lunch:
        # "category:value" — same pairing reasoning as tracks, plus the four
        # sentinels: a lunch question can be free text, where the only useful
        # question is whether it was answered at all.
        clauses = [_lunch_clause(category, value) for category, value in _split_pairs(lunch)]
        if clauses:
            query = query.filter(or_(*clauses))

    if event_preferences:
        # "suffix:tournamentEventId" — an event ranked under one question says
        # nothing about another, so the suffix has to travel with the event.
        clauses = [
            exists().where(
                (TournamentMembershipEventPreference.membership_id == TournamentMembership.id)
                & (TournamentMembershipEventPreference.key == suffix)
                & (true() if event_id == ANY
                   else TournamentMembershipEventPreference.tournament_event_id == int(event_id))
            )
            for suffix, event_id in _split_pairs(event_preferences)
            if event_id == ANY or event_id.isdigit()
        ]
        if clauses:
            query = query.filter(or_(*clauses))

    # Experience is the user's, not the membership's — these join through
    # user_id rather than membership_id.
    if competition_events:
        query = query.filter(exists().where(
            (UserCompetitionExperience.user_id == TournamentMembership.user_id)
            & UserCompetitionExperience.event_id.in_(competition_events)
        ))

    if volunteer_events:
        query = query.filter(exists().where(
            (UserVolunteerExperience.user_id == TournamentMembership.user_id)
            & UserVolunteerExperience.event_id.in_(volunteer_events)
        ))

    if age_flags:
        # is_over_18/21 are hybrid properties derived from date_of_birth, not
        # columns, so they can't be filtered in SQL. Handled by the caller
        # after the rows load — see filter_age_flags.
        pass

    if shifts:
        # "YYYY-MM-DD:shiftId", or ":__any__" for "free at some point that
        # day". The day travels with the shift so the modal can rebuild its
        # day chips from the URL without a second lookup.
        shift_ids: set[int] = set()
        any_days: set[str] = set()
        for day, value in _split_pairs(shifts):
            if value == ANY:
                any_days.add(day)
            elif value.isdigit():
                shift_ids.add(int(value))
        if any_days and tournament is not None:
            shift_ids |= _shift_ids_on_days(query.session, tournament, any_days)
        if shift_ids:
            query = query.filter(exists().where(
                (TournamentMembershipAvailability.membership_id == TournamentMembership.id)
                & TournamentMembershipAvailability.tournament_shift_id.in_(shift_ids)
            ))

    return query


def filter_age_flags(memberships: list, age_flags: list[str] | None) -> list:
    """Keeps only members matching the requested age flags.

    Applied in Python rather than SQL because is_over_18/is_over_21 are hybrid
    properties computed from the user's date of birth against the tournament's
    start date — there's no column to filter on.

    Gated exactly as gate_age_flags gates the response: the tournament must
    collect that flag and the member must have consented. Filtering on the raw
    property instead would leak what consent withheld — a member who declined
    would still appear in a "21+" list, which tells you their flag as surely as
    printing it. It also read as a plain bug, since the row then rendered
    "21+ Unknown" (the response omits the value) inside a 21+ filter.

    A member whose flag is unknown never matches: "show me the 21+ volunteers"
    must not return someone who might not be.
    """
    if not age_flags:
        return memberships

    def matches(membership) -> bool:
        if membership.age_disclosure != "consented":
            return False
        tournament = membership.tournament
        if "over_18" in age_flags and tournament.collect_is_over_18 and membership.is_over_18 is True:
            return True
        if "over_21" in age_flags and tournament.collect_is_over_21 and membership.is_over_21 is True:
            return True
        return False

    return [m for m in memberships if matches(m)]



def build_filter_options(db, tournament) -> dict:
    """Everything the roster's filter modal offers, derived from what this
    tournament actually holds.

    Every paired filter comes back as a group (the left half) carrying its
    own options (the right half), because that's how the modal builds them:
    add a track / a day / a lunch category / an event-preference question as
    a chip, then narrow it with that chip's pill.

    Sources are the catalogs wherever one exists — tracks, shifts and events
    are authoritative even when nobody has answered about them yet (a track
    with no answers is exactly how you find the members who owe one), and
    lunch options come from the lunch question's own config rather than from
    submitted rows. Only experience falls back to submitted data: offering
    every canonical event when three are mentioned makes the picker useless.
    """
    from sqlalchemy import distinct, func
    from app.core.form.validation import (
        EVENT_PREFERENCE_FIELD_KEY_PATTERN, LUNCH_FIELD_KEY_PATTERN, LUNCH_FREE_TEXT_QUESTION_TYPES,
    )
    from app.core.tournament import tournament_local_date
    from app.core.tournament.display_config import unslug
    from app.models.models import (
        Event, Form, FormField, TournamentEvent, TournamentShift, TournamentTrack,
    )

    def scoped(model):
        return (
            db.query(model)
            .join(TournamentMembership, model.membership_id == TournamentMembership.id)
            .filter(TournamentMembership.tournament_id == tournament.id)
        )

    fields = (
        db.query(FormField)
        .join(Form, FormField.form_id == Form.id)
        .filter(Form.tournament_id == tournament.id, FormField.is_archived == False)
        .order_by(FormField.order)
        .all()
    )

    tracks = [
        {"value": str(track.id), "label": track.name}
        for track in db.query(TournamentTrack)
        .filter(TournamentTrack.tournament_id == tournament.id, TournamentTrack.is_archived == False)
        .order_by(TournamentTrack.name)
    ]

    # Grouped by day: a day is the unit a TD thinks in ("who's around
    # Saturday?"), and shift names repeat across the days of a multi-day
    # tournament, so a flat list offers "Impound" twice with nothing to tell
    # the two apart.
    shift_days: dict[str, dict] = {}
    for shift in (
        db.query(TournamentShift)
        .filter(TournamentShift.tournament_id == tournament.id)
        .order_by(TournamentShift.start)
    ):
        day = tournament_local_date(tournament, shift.start)
        group = shift_days.setdefault(
            day.isoformat(),
            {"value": day.isoformat(), "label": f"{day:%a, %b} {day.day}", "options": []},
        )
        group["options"].append({
            "value": str(shift.id),
            "label": f"{shift.label} ({_local_time(tournament, shift.start)}-{_local_time(tournament, shift.end)})",
        })

    lunch_categories = _lunch_groups(
        db, fields, scoped, unslug, LUNCH_FIELD_KEY_PATTERN, LUNCH_FREE_TEXT_QUESTION_TYPES,
    )

    # Every tournament event, not just the ones somebody ranked — the filter
    # is as often used to find who *didn't* pick an event.
    event_options = [
        {
            "value": str(event_id),
            "label": f"{name or 'Unknown event'}{f' ({division})' if division else ''}",
        }
        # func.coalesce is the SQL form of TournamentEvent.display_name:
        # `name` is only set on custom events, so a catalog-linked one takes
        # its name off the joined Event row.
        for event_id, name, division in db.query(
            TournamentEvent.id, func.coalesce(TournamentEvent.name, Event.name), TournamentEvent.division,
        )
        .outerjoin(Event, TournamentEvent.event_id == Event.id)
        .filter(TournamentEvent.tournament_id == tournament.id)
        .order_by(func.coalesce(TournamentEvent.name, Event.name))
    ]
    suffixes = {
        match.group(1)
        for match in (EVENT_PREFERENCE_FIELD_KEY_PATTERN.match(field.field_key) for field in fields)
        if match
    }
    # A question can be deleted after members answered it; the answers stay
    # filterable, so the stored keys are unioned in rather than lost.
    suffixes |= {
        key for (key,) in scoped(TournamentMembershipEventPreference)
        .with_entities(TournamentMembershipEventPreference.key).distinct()
    }
    event_preferences = [
        {"value": suffix, "label": unslug(suffix), "options": event_options}
        for suffix in sorted(suffixes)
    ]

    member_user_ids = (
        db.query(TournamentMembership.user_id)
        .filter(TournamentMembership.tournament_id == tournament.id)
        .subquery()
    )

    def experience_events(model):
        return [
            {"value": str(event_id), "label": name}
            for event_id, name in db.query(distinct(model.event_id), Event.name)
            .join(Event, model.event_id == Event.id)
            .filter(model.user_id.in_(db.query(member_user_ids.c.user_id)))
            .order_by(Event.name)
        ]

    # Roles aren't here: the members page already holds the tournament's role
    # list for the roles editor, so refetching it would be a second source.
    return {
        "tracks": tracks,
        "shift_days": list(shift_days.values()),
        "lunch_categories": lunch_categories,
        "event_preferences": event_preferences,
        "competition_events": experience_events(UserCompetitionExperience),
        "volunteer_events": experience_events(UserVolunteerExperience),
        "collect_is_over_18": bool(tournament.collect_is_over_18),
        "collect_is_over_21": bool(tournament.collect_is_over_21),
    }


def _local_time(tournament, moment) -> str:
    """"7:00 AM" in the tournament's own timezone, for a shift's picker label."""
    from zoneinfo import ZoneInfo

    local = moment.astimezone(ZoneInfo(tournament.timezone))
    return f"{local.hour % 12 or 12}:{local.minute:02d} {'AM' if local.hour < 12 else 'PM'}"


def _lunch_groups(db, fields, scoped, unslug, lunch_pattern, free_text_types) -> list[dict]:
    """Lunch categories, each carrying the values it can be filtered on.

    Options come from the lunch question's own config, so a choice nobody
    picked is still offerable. A free-text lunch question has no options at
    all, so the only thing worth asking of it is whether the member answered
    — plus, for dietary restrictions, whether the answer was "none", which is
    a real answer and not the same as never having filled it in.
    """
    # `free_text` starts False so a category whose question is gone still
    # offers its stored answers — only a question we can see is free text
    # suppresses them, since listing every distinct essay is no picker at all.
    def group_for(category: str) -> dict:
        return groups.setdefault(category, {
            "value": category, "label": unslug(category), "options": [], "free_text": False,
        })

    def add_option(group: dict, value: str, label: str) -> None:
        if value and all(existing["value"] != value for existing in group["options"]):
            group["options"].append({"value": value, "label": label or value})

    groups: dict[str, dict] = {}
    for field in fields:
        match = lunch_pattern.match(field.field_key)
        if not match:
            continue
        group = group_for(match.group(2))
        if field.question_type in free_text_types:
            # Only when nothing else on this category offers choices — a
            # category can be asked twice, once each way.
            group["free_text"] = not group["options"]
            continue
        group["free_text"] = False
        # The stored lunch value is the option's `value` snapshot (see
        # sync_lunch's call site), not its id — so that's what the filter
        # compares against.
        for option in (field.config or {}).get("options", []):
            # A lunch option's `value` is always the TD-typed string (the
            # list[int] shape PlainOption also allows is for entity-backed
            # keys, which lunch never is) — anything else isn't filterable.
            value = option.get("value")
            if not option.get("is_archived") and isinstance(value, str):
                add_option(group, value, option.get("label"))

    # Answers outlive the question that collected them — a deleted or re-keyed
    # lunch question would otherwise take its stored values out of the filter
    # with it.
    stored: dict[str, set[str]] = {}
    for category, value in (
        scoped(TournamentMembershipLunch)
        .with_entities(TournamentMembershipLunch.category, TournamentMembershipLunch.value)
        .distinct()
        .order_by(TournamentMembershipLunch.category, TournamentMembershipLunch.value)
    ):
        stored.setdefault(category, set()).add(value)
        group = group_for(category)
        if not group["free_text"]:
            add_option(group, value, value)

    for category, group in groups.items():
        # ANY and LUNCH_UNANSWERED are filterable but deliberately absent
        # here: the modal offers them as an answered/not-answered toggle
        # above the list rather than as two more rows in it.
        sentinels = []
        # "None" only means something where it's an answer someone can give —
        # a dietary-restrictions question, or a category already holding one.
        # On "Protein" it would just be noise.
        if _looks_dietary(category) or any(v.lower() == "none" for v in stored.get(category, ())):
            sentinels = [
                {"value": LUNCH_NONE, "label": "None"},
                {"value": LUNCH_NOT_NONE, "label": "Not none"},
            ]
        group["options"] = sentinels + group["options"]
        group.pop("free_text")

    return [groups[category] for category in sorted(groups)]


def _looks_dietary(category: str) -> bool:
    return any(word in category for word in ("dietary", "restriction", "allerg"))
