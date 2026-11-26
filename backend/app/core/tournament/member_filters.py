"""Server-side filtering for the members roster.

Every filter here matches against data the roster response does *not* carry —
track statuses at a given status, lunch picks, event preferences, experience,
availability — which is why it can't live in the browser: the client would
have to be sent the whole tournament's onboarding data on every page load to
answer questions about a handful of members.

A filter is a tree of conditions (see apply_member_filter).

Each condition is an EXISTS subquery rather than a join, so a member holding
three of the named roles is returned once, not three times.
"""

from __future__ import annotations

import operator

from sqlalchemy import and_, exists, func, or_, true
from sqlalchemy.orm import Query, aliased, joinedload

from app.core.filter_conditions import FILTER_GROUP_OPS
from app.core.tournament.onboarding import onboarding_paths
from app.models.models import (
    TournamentMembership,
    TournamentMembershipAvailability,
    TournamentMembershipEventPreference,
    TournamentMembershipLunch,
    TournamentMembershipTrackStatus,
    TournamentRole,
    TournamentTrackAssignment,
    University,
    User,
    UserCompetitionExperience,
    UserVolunteerExperience,
)
from app.schemas.tournament.display_config import FilterCondition, FilterGroup

# Sentinel accepted in the `role` filter for members holding no roles at all.
# A plain "no roles" is not expressible as a role id, and it's the one members
# a coordinator most often wants to find.
NO_ROLES = "none"

# A paired value meaning "anything in this group": any status on the track,
# any shift on it, any lunch answer.
ANY = "__any__"

# An event-preference rank condition, carried as one more value beside the
# events: "rank:{op}:{n}", e.g. "rank:le:3" for the top three.
RANK_PREFIX = "rank:"
RANK_OPS = {
    "lt": operator.lt,
    "le": operator.le,
    "eq": operator.eq,
    "ge": operator.ge,
    "gt": operator.gt,
}

# Lunch-only right-hand sentinels. "Unanswered" is the one thing an EXISTS
# over stored rows can't say by naming a value, and none/not-none exist
# because "no dietary restrictions" is an answer of "none" — a missing row
# means the member never filled the question in, which is a different member.
LUNCH_UNANSWERED = "__unanswered__"
LUNCH_NONE = "__none__"
LUNCH_NOT_NONE = "__not_none__"

# Year level values: an undergraduate year ("1".."5", where 5 means fifth or
# later, as on the profile form) or one of these.
YEAR_LEVEL_GRADUATE = "graduate"
YEAR_LEVEL_NON_STUDENT = "non_student"
MAX_YEAR_LEVEL = 5
STUDENT_STATUSES = ("Undergraduate", "Graduate")

ONBOARDING_NOT_STARTED = "not_started"
ONBOARDING_IN_PROGRESS = "in_progress"
ONBOARDING_COMPLETE = "complete"


def _university_short_name():
    """What the members table shows for a school: its abbreviation, else its name."""
    return func.coalesce(func.nullif(func.trim(University.abbreviation), ""), University.name)


def _lunch_clause(category: str, value: str):
    """One lunch filter value as an EXISTS (or NOT EXISTS) over this
    membership's lunch rows for `category`.

    A row only exists once the member answered, so "unanswered" is the
    absence of rows — and "none" has to be the stored string, not a missing
    row: someone who wrote "none" has told you they eat anything, someone
    with no row has told you nothing.
    """
    in_category = (TournamentMembershipLunch.membership_id == TournamentMembership.id) & (
        TournamentMembershipLunch.category == category
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


def _shift_ids_on_tracks(db, tournament, track_ids: set[int]) -> set[int]:
    """Every shift of `tournament` belonging to one of the given tracks."""
    from app.models.models import TournamentShift

    return {
        shift_id
        for (shift_id,) in db.query(TournamentShift.id).filter(
            TournamentShift.tournament_id == tournament.id,
            TournamentShift.track_id.in_(track_ids),
        )
    }


def _roles_clause(values: list[str]):
    # "roleId" or "roleId:trackId" — the role, optionally narrowed to the
    # tracks it is held on. A tournament-wide grant counts on every track
    # (the rule roles_on_track already states), so narrowing to Day 1 keeps
    # a member who holds the role across the whole tournament.
    any_scope: set[int] = set()
    by_role: dict[int, set[int]] = {}
    for value in values:
        if value == NO_ROLES:
            continue
        role_part, _, track_part = value.partition(":")
        if not role_part.isdigit():
            continue
        role_id = int(role_part)
        if track_part and track_part != ANY and track_part.isdigit():
            by_role.setdefault(role_id, set()).add(int(track_part))
        else:
            any_scope.add(role_id)

    clauses = []
    if any_scope:
        clauses.append(
            exists().where(
                (TournamentTrackAssignment.membership_id == TournamentMembership.id)
                & TournamentTrackAssignment.role_id.in_(any_scope)
            )
        )
    for role_id, track_ids in by_role.items():
        # An unnarrowed value for the same role already covers every track.
        if role_id in any_scope:
            continue
        clauses.append(
            exists().where(
                (TournamentTrackAssignment.membership_id == TournamentMembership.id)
                & (TournamentTrackAssignment.role_id == role_id)
                & (
                    TournamentTrackAssignment.tournament_track_id.in_(track_ids)
                    | TournamentTrackAssignment.is_tournament_wide
                )
            )
        )
    if NO_ROLES in values:
        clauses.append(~_holds_a_role())
    return or_(*clauses) if clauses else None


def _holds_a_role():
    return exists().where(TournamentTrackAssignment.membership_id == TournamentMembership.id)


def _tracks_clause(pairs: list[tuple[str, str]]):
    # The pairing is the point. Filtering by track and by status independently
    # would match a member confirmed on one track and declined on another,
    # which is the opposite of what was asked.
    clauses = [
        exists().where(
            (TournamentMembershipTrackStatus.membership_id == TournamentMembership.id)
            & (TournamentMembershipTrackStatus.track_id == int(track_id))
            & (true() if status == ANY else TournamentMembershipTrackStatus.status == status)
        )
        for track_id, status in pairs
        if track_id.isdigit()
    ]
    return or_(*clauses) if clauses else None


def _lunch_values_clause(pairs: list[tuple[str, str]]):
    clauses = [_lunch_clause(category, value) for category, value in pairs]
    return or_(*clauses) if clauses else None


def _event_preferences_clause(pairs: list[tuple[str, str]]):
    # An event ranked for one track says nothing about another, so the track
    # travels with the event. A track's rank condition (see RANK_PREFIX) is
    # checked on the same row as its events, so "Anatomy ranked < 3" can't be
    # met by Anatomy unranked plus some other event at 1.
    events_by_track: dict[int, set[str]] = {}
    rank_by_track: dict[int, tuple[str, int]] = {}
    for track_id, right in pairs:
        if not track_id.isdigit():
            continue
        if right.startswith(RANK_PREFIX):
            op, _, n = right[len(RANK_PREFIX) :].partition(":")
            if op in RANK_OPS and n.isdigit():
                rank_by_track[int(track_id)] = (op, int(n))
        elif right == ANY or right.isdigit():
            events_by_track.setdefault(int(track_id), set()).add(right)

    clauses = []
    # A rank alone, with no events picked, means any event at that rank.
    for track_id in events_by_track.keys() | rank_by_track.keys():
        events = events_by_track.get(track_id, {ANY})
        condition = (
            TournamentMembershipEventPreference.membership_id == TournamentMembership.id
        ) & (TournamentMembershipEventPreference.track_id == track_id)
        if ANY not in events:
            condition &= TournamentMembershipEventPreference.tournament_event_id.in_(
                [int(event_id) for event_id in events]
            )
        if track_id in rank_by_track:
            op, n = rank_by_track[track_id]
            # An unranked row's NULL rank fails every comparison.
            condition &= RANK_OPS[op](TournamentMembershipEventPreference.rank, n)
        clauses.append(exists().where(condition))
    return or_(*clauses) if clauses else None


def _shifts_clause(session, tournament, pairs: list[tuple[str, str]]):
    # "trackId:shiftId", or "trackId:__any__" for free at some point on that
    # track.
    shift_ids: set[int] = set()
    any_tracks: set[int] = set()
    for track_id, value in pairs:
        if value == ANY and track_id.isdigit():
            any_tracks.add(int(track_id))
        elif value.isdigit():
            shift_ids.add(int(value))
    if any_tracks:
        shift_ids |= _shift_ids_on_tracks(session, tournament, any_tracks)
    if not shift_ids:
        return None
    return exists().where(
        (TournamentMembershipAvailability.membership_id == TournamentMembership.id)
        & TournamentMembershipAvailability.tournament_shift_id.in_(shift_ids)
    )


def _experience_clause(model, values: list[str] | None):
    """Experience is the user's, not the membership's, so it joins through
    user_id. None for `values` asks for any experience at all."""
    condition = model.user_id == TournamentMembership.user_id
    if values is not None:
        event_ids = [int(value) for value in values if value.isdigit()]
        if not event_ids:
            return None
        condition &= model.event_id.in_(event_ids)
    return exists().where(condition)


def _affiliation_clause(session, values: list[str] | None):
    """The text the Affiliation column shows, matched without case: one value
    covers a student at a school and a non-student working at one by the same
    name. None for `values` asks for any affiliation at all."""
    # Aliased so the EXISTS stays correlated on its own User even when the
    # name search has already joined one into the outer query.
    user = aliased(User)
    if values is None:
        school = user.university_id.is_not(None)
        employer = func.coalesce(func.trim(user.employer), "") != ""
    else:
        names = {value.strip().lower() for value in values if value.strip()}
        if not names:
            return None
        schools = session.query(University.id).filter(
            func.lower(_university_short_name()).in_(names)
        )
        school = user.university_id.in_(schools)
        employer = func.lower(func.trim(user.employer)).in_(names)
    return exists().where(
        (user.id == TournamentMembership.user_id)
        & or_(
            user.student_status.in_(STUDENT_STATUSES) & school,
            (user.student_status == "Non-Student") & employer,
        )
    )


def _assignments_clause(track: str | None, values: list[str] | None):
    """Staffed on `track`: on one of the named events, or at all for None."""
    if not (track and track.isdigit()):
        return None
    condition = (TournamentTrackAssignment.membership_id == TournamentMembership.id) & (
        TournamentTrackAssignment.tournament_track_id == int(track)
    )
    if values is not None:
        event_ids = [int(value) for value in values if value.isdigit()]
        if not event_ids:
            return None
        condition &= TournamentTrackAssignment.tournament_event_id.in_(event_ids)
    return exists().where(condition)


def _year_levels_clause(values: list[str]):
    user = aliased(User)
    clauses = []
    for value in values:
        if value == YEAR_LEVEL_GRADUATE:
            clauses.append(user.student_status == "Graduate")
        elif value == YEAR_LEVEL_NON_STUDENT:
            clauses.append(user.student_status == "Non-Student")
        elif value.isdigit() and 1 <= int(value) <= MAX_YEAR_LEVEL:
            year = int(value)
            clauses.append(
                (user.student_status == "Undergraduate")
                & (user.year_level >= year if year == MAX_YEAR_LEVEL else user.year_level == year)
            )
    if not clauses:
        return None
    return exists().where((user.id == TournamentMembership.user_id) & or_(*clauses))


# ---------------------------------------------------------------------------
# Filter conditions
#
# The roster's filter is a FilterGroup (see filter_conditions.py). Paired
# fields name their track or lunch category in `group`; the rest take none.
# ---------------------------------------------------------------------------
PAIRED_FIELDS = frozenset({"track", "assigned", "lunch", "event_pref", "shift"})
_ANY_NONE = frozenset({"any_of", "none_of"})
_ALL_OPS = _ANY_NONE | {"empty", "not_empty"}
# "Has every one of", for fields a member can hold several values of at once.
_MANY_OPS = _ALL_OPS | {"all_of"}
ROSTER_FIELD_OPS: dict[str, frozenset[str]] = {
    "role": _MANY_OPS,
    "track": _ALL_OPS,
    "assigned": _MANY_OPS,
    "lunch": _ALL_OPS,
    "event_pref": _ALL_OPS,
    "shift": _ALL_OPS,
    "competition_event": _MANY_OPS,
    "volunteer_event": _MANY_OPS,
    "affiliation": _ALL_OPS,
    "age": _ANY_NONE,
    "year_level": _ANY_NONE,
    "onboarding": _ANY_NONE,
}


def roster_condition_problem(condition: FilterCondition) -> str | None:
    """Why the roster can't apply `condition`, or None if it can."""
    ops = ROSTER_FIELD_OPS.get(condition.field)
    if ops is None:
        return f"Unknown filter '{condition.field}'"
    if condition.op not in ops:
        return f"Filter '{condition.field}' does not take '{condition.op}'"
    if (condition.field in PAIRED_FIELDS) != bool(condition.group):
        needs = "needs" if condition.field in PAIRED_FIELDS else "takes no"
        return f"Filter '{condition.field}' {needs} a group"
    return None


class _Context:
    """What evaluating one filter needs beyond the conditions themselves, with
    the Python-side matches (age, onboarding) computed at most once."""

    def __init__(self, session, tournament):
        self.session = session
        self.tournament = tournament
        self._members: list[TournamentMembership] | None = None
        self.paths: dict | None = None

    def _all_members(self) -> list[TournamentMembership]:
        if self._members is None:
            self._members = (
                self.session.query(TournamentMembership)
                .options(joinedload(TournamentMembership.user))
                .filter(TournamentMembership.tournament_id == self.tournament.id)
                .all()
            )
        return self._members

    def derived_ids(self, field: str, values: list[str]) -> set[int]:
        """Age flags and onboarding are derived, not stored, so they're worked
        out for every member and the matches folded back in as ids."""
        members = self._all_members()
        if field == "age":
            return {m.id for m in filter_age_flags(members, values)}
        if self.paths is None:
            self.paths = onboarding_paths(
                self.session, self.tournament.id, [m.user_id for m in members]
            )
        return {m.id for m in filter_onboarding(members, values, self.paths)}


def _present_clause(ctx: _Context, field: str, group: str | None):
    """The member has something for `field` (in `group`, for a paired one)."""
    if field == "role":
        return _holds_a_role()
    if field == "competition_event":
        return _experience_clause(UserCompetitionExperience, None)
    if field == "volunteer_event":
        return _experience_clause(UserVolunteerExperience, None)
    if field == "affiliation":
        return _affiliation_clause(ctx.session, None)
    if field == "assigned":
        return _assignments_clause(group, None)
    if field == "lunch":
        return _lunch_clause(group or "", ANY)
    if not (group and group.isdigit()):
        return None
    track_id = int(group)
    if field == "track":
        return exists().where(
            (TournamentMembershipTrackStatus.membership_id == TournamentMembership.id)
            & (TournamentMembershipTrackStatus.track_id == track_id)
        )
    if field == "event_pref":
        return exists().where(
            (TournamentMembershipEventPreference.membership_id == TournamentMembership.id)
            & (TournamentMembershipEventPreference.track_id == track_id)
        )
    if field == "shift":
        shift_ids = _shift_ids_on_tracks(ctx.session, ctx.tournament, {track_id})
        return exists().where(
            (TournamentMembershipAvailability.membership_id == TournamentMembership.id)
            & TournamentMembershipAvailability.tournament_shift_id.in_(shift_ids)
        )
    return None


def _values_clause(ctx: _Context, field: str, group: str | None, values: list[str]):
    """The member matches any of `values`; None when nothing usable was named."""
    if not values:
        return None
    pairs = [(group or "", value) for value in values]
    match field:
        case "role":
            return _roles_clause(values)
        case "track":
            return _tracks_clause(pairs)
        case "lunch":
            return _lunch_values_clause(pairs)
        case "event_pref":
            return _event_preferences_clause(pairs)
        case "shift":
            return _shifts_clause(ctx.session, ctx.tournament, pairs)
        case "assigned":
            return _assignments_clause(group, values)
        case "competition_event":
            return _experience_clause(UserCompetitionExperience, values)
        case "volunteer_event":
            return _experience_clause(UserVolunteerExperience, values)
        case "affiliation":
            return _affiliation_clause(ctx.session, values)
        case "year_level":
            return _year_levels_clause(values)
        case "age" | "onboarding":
            return TournamentMembership.id.in_(ctx.derived_ids(field, values))
    return None


def _condition_clause(ctx: _Context, condition: FilterCondition):
    if roster_condition_problem(condition) is not None:
        return None
    if condition.op in ("empty", "not_empty"):
        present = _present_clause(ctx, condition.field, condition.group)
        if present is None:
            return None
        return ~present if condition.op == "empty" else present
    if condition.op == "all_of":
        each = [
            clause
            for value in condition.values
            if (clause := _values_clause(ctx, condition.field, condition.group, [value]))
            is not None
        ]
        return and_(*each) if each else None
    clause = _values_clause(ctx, condition.field, condition.group, condition.values)
    if clause is None:
        return None
    return ~clause if condition.op == "none_of" else clause


def _group_clause(ctx: _Context, group: FilterGroup, *, nested: bool = False):
    if group.op not in FILTER_GROUP_OPS:
        return None
    clauses = []
    for item in group.conditions:
        if isinstance(item, FilterCondition):
            clause = _condition_clause(ctx, item)
        else:
            clause = None if nested else _group_clause(ctx, item, nested=True)
        if clause is not None:
            clauses.append(clause)
    if not clauses:
        return None
    return or_(*clauses) if group.op == "or" else and_(*clauses)


def apply_member_filter(query: Query, tournament, group: FilterGroup) -> tuple[Query, dict | None]:
    """Narrows a TournamentMembership query by a roster filter. Also returns
    every member's onboarding_paths when an onboarding condition computed
    them, else None.

    Lenient, like the paired values: a condition the roster can't apply (a
    field or operator a later release dropped) is skipped rather than failing
    the load, and a group left with nothing to apply narrows nothing."""
    ctx = _Context(query.session, tournament)
    clause = _group_clause(ctx, group)
    return (query if clause is None else query.filter(clause)), ctx.paths


def filter_age_flags(memberships: list, age_flags: list[str] | None) -> list:
    """Keeps only members matching the requested age flags.

    Applied in Python rather than SQL because is_over_18/is_over_21 are hybrid
    properties computed from the user's date of birth against the tournament's
    start date — there's no column to filter on.

    Gated exactly as gate_age_flags gates the response: the tournament must
    collect that flag and the member must have consented. Filtering on the raw
    property instead would leak what consent withheld — a member who hasn't
    consented would still appear in a "21+" list, which tells you their flag as surely as
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
        flags = (
            ("18", tournament.collect_is_over_18, membership.is_over_18),
            ("21", tournament.collect_is_over_21, membership.is_over_21),
        )
        # `is True` / `is False`: an unknown flag is neither over nor under.
        for age, collected, over in flags:
            if not collected:
                continue
            if f"over_{age}" in age_flags and over is True:
                return True
            if f"under_{age}" in age_flags and over is False:
                return True
        return False

    return [m for m in memberships if matches(m)]


def filter_onboarding(memberships: list, states: list[str], paths: dict) -> list:
    """Keeps members whose onboarding is in one of `states`: "not_started",
    "in_progress" or "complete", given each member's onboarding_paths.
    Unknown states are dropped, like any unresolvable filter value.

    In Python, like filter_age_flags: a member's path depends on which steps
    their roles qualify them for, so there's no stored progress to query. A
    member with no steps owes nothing, so counts as complete.
    """
    wanted = set(states) & {ONBOARDING_NOT_STARTED, ONBOARDING_IN_PROGRESS, ONBOARDING_COMPLETE}
    if not wanted:
        return memberships

    def state(path) -> str:
        done = sum(step.completed for step in path)
        if done == len(path):
            return ONBOARDING_COMPLETE
        return ONBOARDING_IN_PROGRESS if done else ONBOARDING_NOT_STARTED

    return [m for m in memberships if state(paths[m.user_id]) in wanted]


def build_filter_options(db, tournament) -> dict:
    """Everything the roster's filter modal offers, derived from what this
    tournament actually holds.

    Every paired filter comes back as groups (a track or lunch category),
    each carrying its own options, since a condition picks its group first.

    Sources are the catalogs wherever one exists — tracks, shifts and events
    are authoritative even when nobody has answered about them yet (a track
    with no answers is exactly how you find the members who owe one), and
    lunch options come from the lunch question's own config rather than from
    submitted rows. Only experience falls back to submitted data: offering
    every canonical event when three are mentioned makes the picker useless.
    """
    from sqlalchemy import func

    from app.core.form.validation import (
        EVENT_PREFERENCE_FIELD_KEY_PATTERN,
        LUNCH_FIELD_KEY_PATTERN,
        LUNCH_FREE_TEXT_QUESTION_TYPES,
    )
    from app.core.tournament.display_config import unslug
    from app.core.tournament.tracks import track_event_ids
    from app.models.models import (
        Event,
        Form,
        FormField,
        TournamentEvent,
        TournamentForm,
        TournamentShift,
        TournamentTrack,
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
        .filter(
            TournamentTrack.tournament_id == tournament.id, TournamentTrack.is_archived == False
        )
        .order_by(TournamentTrack.name)
    ]

    # Grouped by track: shift names repeat across tracks ("Impound" on both
    # days), and two sites can run the same Saturday.
    track_names = {t["value"]: t["label"] for t in tracks}
    shift_days: dict[str, dict] = {}
    for shift in (
        db.query(TournamentShift)
        .filter(TournamentShift.tournament_id == tournament.id)
        .order_by(TournamentShift.start)
    ):
        key = str(shift.track_id)
        # track_names holds live tracks only — a pending-delete one is not
        # something to filter by.
        if key not in track_names:
            continue
        group = shift_days.setdefault(
            key,
            {"value": key, "label": track_names[key], "options": []},
        )
        group["options"].append(
            {
                "value": str(shift.id),
                "label": f"{shift.label} ({_local_time(tournament, shift.start)}-{_local_time(tournament, shift.end)})",
            }
        )

    lunch_categories = _lunch_groups(
        db,
        fields,
        scoped,
        unslug,
        LUNCH_FIELD_KEY_PATTERN,
        LUNCH_FREE_TEXT_QUESTION_TYPES,
    )

    # Every tournament event, not just the ones somebody ranked — the filter
    # is as often used to find who *didn't* pick an event.
    # "Boomilever C", not "Boomilever (C)" — the division is part of the
    # event's name here rather than an aside about it, the same way the
    # client's eventNameWithDivision reads it. Name alone can't identify a
    # row: the same event usually runs in two divisions.
    event_options = [
        {
            "value": str(event_id),
            "label": f"{name or 'Unknown event'}{f' {division}' if division else ''}",
        }
        # func.coalesce is the SQL form of TournamentEvent.display_name:
        # `name` is only set on custom events, so a catalog-linked one takes
        # its name off the joined Event row.
        for event_id, name, division in db.query(
            TournamentEvent.id,
            func.coalesce(TournamentEvent.name, Event.name),
            TournamentEvent.division,
        )
        .outerjoin(Event, TournamentEvent.event_id == Event.id)
        .filter(TournamentEvent.tournament_id == tournament.id)
        # By division too, now that it ends the label: the two Chess rows
        # would otherwise sit in whatever order the rows came back in.
        .order_by(func.coalesce(TournamentEvent.name, Event.name), TournamentEvent.division)
    ]
    pref_track_ids = {
        match.group(1)
        for match in (EVENT_PREFERENCE_FIELD_KEY_PATTERN.match(field.field_key) for field in fields)
        if match
    }
    # A question can be deleted after members answered it; the answers stay
    # filterable, so the stored tracks are unioned in rather than lost.
    stored_prefs = (
        scoped(TournamentMembershipEventPreference)
        .with_entities(
            TournamentMembershipEventPreference.track_id,
            TournamentMembershipEventPreference.tournament_event_id,
        )
        .distinct()
        .all()
    )
    pref_track_ids |= {str(track_id) for track_id, _ in stored_prefs}
    # Live tracks only, like every other group here.
    pref_track_ids &= set(track_names)

    def events_on(track_id: str) -> list[dict]:
        # The question's own rule (validate_event_preference_options), plus
        # anything already ranked there, so an answer outlives its event
        # leaving the track.
        allowed = (
            {str(e) for e in track_event_ids(db, int(track_id))} if track_id.isdigit() else set()
        )
        allowed |= {str(e) for t, e in stored_prefs if str(t) == track_id}
        return [option for option in event_options if option["value"] in allowed]

    event_preferences = [
        {
            "value": track_id,
            "label": track_names.get(track_id, "Unknown track"),
            "options": events_on(track_id),
        }
        for track_id in sorted(pref_track_ids, key=lambda t: track_names.get(t, ""))
    ]

    member_user_ids = (
        db.query(TournamentMembership.user_id)
        .filter(TournamentMembership.tournament_id == tournament.id)
        .subquery()
    )

    def experience_events(model):
        return [
            {"value": str(event_id), "label": name}
            for event_id, name in db.query(model.event_id, Event.name)
            .distinct()
            .join(Event, model.event_id == Event.id)
            .filter(model.user_id.in_(db.query(member_user_ids.c.user_id)))
            .order_by(Event.name)
        ]

    # Only what members have entered: every university in the catalog would
    # make the picker useless, as with experience. Spellings differing only in
    # case or spacing are one option, labelled as the school spells it.
    members = db.query(User).filter(User.id.in_(db.query(member_user_ids.c.user_id)))
    school_names = (
        members.filter(User.student_status.in_(STUDENT_STATUSES))
        .join(University, User.university_id == University.id)
        .with_entities(_university_short_name())
        .distinct()
    )
    employer_names = (
        members.filter(User.student_status == "Non-Student")
        .with_entities(func.trim(User.employer))
        .distinct()
    )
    affiliations: dict[str, str] = {}
    for (name,) in [*school_names, *employer_names]:
        if name:
            affiliations.setdefault(name.lower(), name)

    # Roles aren't here: the members page already holds the tournament's role
    # list for the roles editor, so refetching it would be a second source.
    return {
        "tracks": tracks,
        "shift_days": list(shift_days.values()),
        "lunch_categories": lunch_categories,
        "event_preferences": event_preferences,
        # Per track, the events someone can be assigned to there.
        "assignments": [
            {"value": track["value"], "label": track["label"], "options": events_on(track["value"])}
            for track in tracks
        ],
        "competition_events": experience_events(UserCompetitionExperience),
        "volunteer_events": experience_events(UserVolunteerExperience),
        "affiliations": [
            {"value": name, "label": name} for _, name in sorted(affiliations.items())
        ],
        "collect_is_over_18": bool(tournament.collect_is_over_18),
        "collect_is_over_21": bool(tournament.collect_is_over_21),
        # The steps onboarding_paths counts: live ones, and archived ones
        # that may still have answers.
        "has_onboarding": db.query(TournamentForm.form_id)
        .join(Form, TournamentForm.form_id == Form.id)
        .filter(
            TournamentForm.tournament_id == tournament.id,
            TournamentForm.is_onboarding == True,
            Form.status.in_(["published", "archived"]),
        )
        .first()
        is not None,
    }


def _local_time(tournament, moment) -> str:
    """ "7:00 AM" in the tournament's own timezone, for a shift's picker label."""
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
        return groups.setdefault(
            category,
            {
                "value": category,
                "label": unslug(category),
                "options": [],
                "free_text": False,
            },
        )

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
        # Answered or not is the is-empty / is-not-empty operator, not an option.
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


def apply_member_search(
    query: Query,
    db,
    *,
    q: str | None = None,
    role_id: int | None = None,
    exclude_role_id: int | None = None,
    max_rank: int | None = None,
) -> Query:
    """The identity/authority narrowing the role-assignment pickers need.

    Separate from apply_member_filter because it asks a different kind of
    question: that one filters on what a member *answered*, this one on who
    they are and how much authority they hold. Both apply to the same roster
    query — a picker is the roster with a name search and a role bound on it,
    which is why there is no longer a second route for it.

    - `q` matches first name, last name or email.
    - `role_id` keeps only members holding that role (the roles editor's
      "Manage Members" tab).
    - `exclude_role_id` drops members who already hold it (its "Add Members"
      picker).
    - `max_rank` drops members whose highest-authority role ties or outranks
      that rank — lower rank number means more authority. Callers pass their
      own rank so a picker never offers someone validate_role_action would
      reject anyway.

    All four are independent and combine.
    """
    if q:
        like = f"%{q}%"
        query = query.join(User, User.id == TournamentMembership.user_id).filter(
            or_(
                User.first_name.ilike(like),
                User.last_name.ilike(like),
                User.email.ilike(like),
            )
        )
    if role_id is not None:
        held_role = db.query(TournamentTrackAssignment.membership_id).filter(
            TournamentTrackAssignment.role_id == role_id
        )
        query = query.filter(TournamentMembership.id.in_(held_role))
    if exclude_role_id is not None:
        held_by_role = db.query(TournamentTrackAssignment.membership_id).filter(
            TournamentTrackAssignment.role_id == exclude_role_id
        )
        query = query.filter(TournamentMembership.id.notin_(held_by_role))
    if max_rank is not None:
        # Members with no roles have no authority and always pass. Members
        # with roles are kept only if their highest-authority (lowest rank
        # number) role is strictly less authoritative than max_rank.
        outranks_or_ties = (
            db.query(TournamentTrackAssignment.membership_id)
            .join(TournamentRole, TournamentRole.id == TournamentTrackAssignment.role_id)
            .group_by(TournamentTrackAssignment.membership_id)
            .having(func.min(TournamentRole.rank) <= max_rank)
        )
        query = query.filter(TournamentMembership.id.notin_(outranks_or_ties))
    return query
