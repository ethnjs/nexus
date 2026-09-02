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

from sqlalchemy import exists, or_
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


def apply_member_filters(
    query: Query,
    *,
    roles: list[str] | None = None,
    tracks: list[str] | None = None,
    lunch: list[str] | None = None,
    event_preferences: list[str] | None = None,
    competition_events: list[int] | None = None,
    volunteer_events: list[int] | None = None,
    age_flags: list[str] | None = None,
    shifts: list[int] | None = None,
) -> Query:
    """Narrows a TournamentMembership query by the roster's filter params."""
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
                & (TournamentMembershipTrackStatus.status == status)
            )
            for track_id, status in _split_pairs(tracks)
            if track_id.isdigit()
        ]
        if clauses:
            query = query.filter(or_(*clauses))

    if lunch:
        # "category:value" — same pairing reasoning as tracks.
        clauses = [
            exists().where(
                (TournamentMembershipLunch.membership_id == TournamentMembership.id)
                & (TournamentMembershipLunch.category == category)
                & (TournamentMembershipLunch.value == value)
            )
            for category, value in _split_pairs(lunch)
        ]
        if clauses:
            query = query.filter(or_(*clauses))

    if event_preferences:
        # "suffix:tournamentEventId" — an event ranked under one question says
        # nothing about another, so the suffix has to travel with the event.
        clauses = [
            exists().where(
                (TournamentMembershipEventPreference.membership_id == TournamentMembership.id)
                & (TournamentMembershipEventPreference.key == suffix)
                & (TournamentMembershipEventPreference.tournament_event_id == int(event_id))
            )
            for suffix, event_id in _split_pairs(event_preferences)
            if event_id.isdigit()
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
        query = query.filter(exists().where(
            (TournamentMembershipAvailability.membership_id == TournamentMembership.id)
            & TournamentMembershipAvailability.tournament_shift_id.in_(shifts)
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

    Options come from submitted data rather than from a catalog wherever the
    catalog wouldn't narrow it: there's no table of lunch choices, and offering
    every canonical event when three are mentioned in anyone's experience makes
    the picker useless. Tracks and shifts do have catalogs, so those are
    authoritative — a track nobody has answered for is still worth filtering by
    (it finds the members who owe an answer).
    """
    from sqlalchemy import distinct, func
    from app.core.tournament.display_config import unslug
    from app.models.models import Event, TournamentEvent, TournamentShift, TournamentTrack

    def scoped(model):
        return (
            db.query(model)
            .join(TournamentMembership, model.membership_id == TournamentMembership.id)
            .filter(TournamentMembership.tournament_id == tournament.id)
        )

    tracks = [
        {"value": str(track.id), "label": track.name}
        for track in db.query(TournamentTrack)
        .filter(TournamentTrack.tournament_id == tournament.id, TournamentTrack.is_archived == False)
        .order_by(TournamentTrack.name)
    ]

    lunch = [
        {"value": f"{category}:{value}", "label": f"{unslug(category)}: {value}"}
        for category, value in scoped(TournamentMembershipLunch)
        .with_entities(TournamentMembershipLunch.category, TournamentMembershipLunch.value)
        .distinct()
        .order_by(TournamentMembershipLunch.category, TournamentMembershipLunch.value)
    ]

    event_preferences = [
        {
            "value": f"{key}:{event_id}",
            "label": f"{unslug(key)}: {name or 'Unknown event'}{f' ({division})' if division else ''}",
        }
        for key, event_id, name, division in scoped(TournamentMembershipEventPreference)
        .join(TournamentEvent, TournamentMembershipEventPreference.tournament_event_id == TournamentEvent.id)
        .outerjoin(Event, TournamentEvent.event_id == Event.id)
        .with_entities(
            TournamentMembershipEventPreference.key,
            TournamentEvent.id,
            # The SQL form of TournamentEvent.display_name: `name` is only set
            # on custom events, so a catalog-linked one takes its name off the
            # joined Event row. Reading TournamentEvent.name alone renders
            # every catalog event as "Unknown event".
            func.coalesce(TournamentEvent.name, Event.name),
            TournamentEvent.division,
        )
        .distinct()
        .order_by(TournamentMembershipEventPreference.key)
    ]

    # Labelled with their day: shift names repeat across a multi-day
    # tournament ("Impound" on both Saturdays), and a picker offering the same
    # word twice is unusable.
    from app.core.tournament import tournament_local_date

    shifts = [
        {
            "value": str(shift.id),
            "label": f"{shift.label} — {tournament_local_date(tournament, shift.start).strftime('%b')} "
                     f"{tournament_local_date(tournament, shift.start).day}",
        }
        for shift in db.query(TournamentShift)
        .filter(TournamentShift.tournament_id == tournament.id)
        .order_by(TournamentShift.start)
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
        "lunch": lunch,
        "event_preferences": event_preferences,
        "competition_events": experience_events(UserCompetitionExperience),
        "volunteer_events": experience_events(UserVolunteerExperience),
        "shifts": shifts,
        "collect_is_over_18": bool(tournament.collect_is_over_18),
        "collect_is_over_21": bool(tournament.collect_is_over_21),
    }
