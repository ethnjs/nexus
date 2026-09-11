"""Shared constants for the per-member display_config JSON column (see
TASK.md Phase 3). Surface keys name a UI location; namespaced strings in a
surface's `hidden` list each identify one hideable item, e.g. "track:3".

Kept here (not inline in the route) so 3.3's apply-the-config step reuses the
same known sets rather than redefining them."""

from datetime import datetime

from app.core.tournament import tournament_local_date

MEMBERS_PANEL = "members_panel"
MEMBERS_TABLE = "members_table"
MEMBER_PAGE = "member_page"
ASSIGNMENT_CARD = "assignment_card"
EVENTS_TABLE = "events_table"
# The assignments board's event rows. Separate from ASSIGNMENT_CARD (the belt
# card beside them) because the two are configured by their own controls and
# share no vocabulary — one describes an event, the other a person.
ASSIGNMENTS_EVENTS = "assignments_events"

KNOWN_SURFACES = frozenset({
    MEMBERS_PANEL, MEMBERS_TABLE, MEMBER_PAGE, ASSIGNMENT_CARD, EVENTS_TABLE,
    ASSIGNMENTS_EVENTS,
})

# ---------------------------------------------------------------------------
# Members table view state
#
# Filters and sort live in the same per-member surface blob as the columns:
# all three are "how this coordinator reads the roster", they're read in the
# same request the page already makes, and they're written by the same PUT.
#
# Filter keys are exactly the roster query params (see list_memberships) —
# stored under the name the client will send them back as, so persisting is
# a round trip through one vocabulary rather than a translation. Values are
# opaque here on purpose: "2:confirmed", a shift id, "__any__" — the filter
# layer already ignores anything that no longer resolves, so a deleted track
# in someone's saved filters is inert rather than an error.
# ---------------------------------------------------------------------------
KNOWN_FILTER_KEYS = frozenset({
    "role", "track", "lunch", "event_pref",
    "competition_event", "volunteer_event", "age", "shift", "assigned",
})

# Sorting is client-side (the roster is one page), so these are validated but
# never used in a query — they exist so a stored value that no longer sorts
# by anything can't be written in the first place.
KNOWN_SORT_FIELDS = frozenset({"first_name", "last_name", "joined", "account_age"})
KNOWN_SORT_DIRECTIONS = frozenset({"asc", "desc"})

# ---------------------------------------------------------------------------
# Members table columns
#
# The table is column-configurable rather than fixed. Name/roles/actions are
# deliberately absent: they're the row's identity and its controls, not data
# a TD would ever turn off. Everything here is opt-in per column, and the
# per-entity ones (one column per track / availability day / lunch category /
# custom field) are off by default — a tournament with a dozen of each would
# otherwise open to an unreadable table.
# ---------------------------------------------------------------------------
COLUMN_EMAIL = "email"
COLUMN_PHONE = "phone"
COLUMN_ACCOUNT_AGE = "account_age"
COLUMN_JOINED = "joined"
COLUMN_METHOD = "method"
COLUMN_AGE = "age"
COLUMN_SHIRT_SIZE = "shirt_size"

FIXED_COLUMNS: tuple[tuple[str, str], ...] = (
    (COLUMN_EMAIL, "Email"),
    (COLUMN_PHONE, "Phone"),
    (COLUMN_ACCOUNT_AGE, "Account age"),
    (COLUMN_JOINED, "Joined"),
    (COLUMN_METHOD, "Join method"),
    (COLUMN_AGE, "Age"),
    (COLUMN_SHIRT_SIZE, "Shirt size"),
)

# What a tournament with no saved column config shows — roughly today's table,
# so the feature landing doesn't silently rearrange anyone's roster.
DEFAULT_COLUMNS: tuple[str, ...] = (
    COLUMN_EMAIL, COLUMN_PHONE, COLUMN_ACCOUNT_AGE, COLUMN_JOINED, COLUMN_METHOD,
)

# ---------------------------------------------------------------------------
# Events table
#
# Same three pieces of view state as the roster (columns, filters, sort) in
# the same per-member blob, for the same reason — but its own vocabulary
# throughout: an event has no email and a member has no division, so nothing
# is shared between the two surfaces except the storage shape.
#
# Every column is a plain scalar on the event, so unlike the roster there are
# no per-entity columns here: a tournament adding a track adds a track *chip*
# to the existing Tracks cell, not a column.
# ---------------------------------------------------------------------------
EVENT_COLUMN_DIVISION = "division"
EVENT_COLUMN_TYPE = "type"
EVENT_COLUMN_CATEGORY = "category"
EVENT_COLUMN_TRACKS = "tracks"
EVENT_COLUMN_SHIFTS = "shifts"
EVENT_COLUMN_BUILDING = "building"
EVENT_COLUMN_ROOM = "room"
EVENT_COLUMN_FLOOR = "floor"
EVENT_COLUMN_VOLUNTEERS_NEEDED = "volunteers_needed"

EVENT_COLUMNS: tuple[tuple[str, str], ...] = (
    (EVENT_COLUMN_DIVISION, "Division"),
    (EVENT_COLUMN_TYPE, "Type"),
    (EVENT_COLUMN_CATEGORY, "Category"),
    (EVENT_COLUMN_TRACKS, "Tracks"),
    (EVENT_COLUMN_SHIFTS, "Shifts"),
    (EVENT_COLUMN_BUILDING, "Building"),
    (EVENT_COLUMN_ROOM, "Room"),
    (EVENT_COLUMN_FLOOR, "Floor"),
    (EVENT_COLUMN_VOLUNTEERS_NEEDED, "Volunteers needed"),
)

# Today's fixed table, so the feature landing doesn't rearrange anyone's
# events page. Location and staffing target are opt-in: they're blank for
# most of planning and would be four empty columns until the week of.
DEFAULT_EVENT_COLUMNS: tuple[str, ...] = (
    EVENT_COLUMN_DIVISION, EVENT_COLUMN_TYPE, EVENT_COLUMN_CATEGORY,
    EVENT_COLUMN_TRACKS, EVENT_COLUMN_SHIFTS,
)

# Unlike the roster's, these filters are applied in the client (the events
# list is one page and every filtered field is already on the row), so the
# stored values are the *selected* ones the FilterModal deals in rather than
# query params — an empty list for a key means that key narrows nothing.
# Opaque here either way: a category that no longer exists is inert, exactly
# as a deleted track is on the roster.
KNOWN_EVENT_FILTER_KEYS = frozenset({"division", "type", "category"})

KNOWN_EVENT_SORT_FIELDS = frozenset({"name", "division", "day"})


# ---------------------------------------------------------------------------
# Assignments board — event rows
#
# `columns` here are the optional bits of metadata a row prints under the
# event name, not table columns; the storage shape is the same ("what this
# viewer has turned on, in order") so it reuses the same field rather than
# inventing a parallel one. Its own key set, though — an event row shows a
# time *range* the events table has no column for, and the table's category /
# volunteers-needed have nowhere to go on a row.
#
# No `shifts` entry: the row's timeline already is the shift display.
ASSIGNMENT_EVENT_COLUMNS: tuple[str, ...] = (
    "division", "type", "room", "time", "tracks",
)

# Everything on. A row's metadata is one line of small text, so the default
# is "show what you have" and a TD trims from there.
DEFAULT_ASSIGNMENT_EVENT_COLUMNS: tuple[str, ...] = ASSIGNMENT_EVENT_COLUMNS

# Filtered in the client like the events table, so these store the *selected*
# values too. Two keys more than that table: the board loads assignments and
# per-event tracks, so it can offer staffed/unstaffed and track sections the
# events page has no data for.
KNOWN_ASSIGNMENT_EVENT_FILTER_KEYS = frozenset({
    "division", "type", "category", "track", "staffing",
})

# ---------------------------------------------------------------------------
# Assignments board — member belt card
#
# Hidden-by-exception, matching the card's client-side model: a field absent
# from `hidden` shows, so a field added to the card later is visible without
# migrating anyone's saved state.
#
# Its filters are the roster's vocabulary (KNOWN_FILTER_KEYS) — the belt is
# filtered by the members modal — but a separate surface from MEMBERS_TABLE
# on purpose: narrowing the belt to staff an event is a different question
# from how you last read the roster, and one must not clobber the other.
# ---------------------------------------------------------------------------
CARD_FIELD_NAMESPACE = "card_field:"
CARD_TRACK_NAMESPACE = "card_track:"

ASSIGNMENT_CARD_FIELDS = frozenset({
    "roles", "age", "track_status", "event_preferences", "availability",
    "competition_school", "competition_event",
    "volunteer_tournament", "volunteer_event", "volunteer_role",
})

# The fields that are a per-track list, and so can be hidden one track at a
# time ("card_track:{field}:{track_id}"). Scoped per field, not shared: a TD
# may well want Day 1's preferences beside every track's availability.
ASSIGNMENT_CARD_TRACK_SCOPED_FIELDS = frozenset({
    "track_status", "event_preferences", "availability",
})


# ---------------------------------------------------------------------------
# Member panel sections
#
# Built-in sections keep a stable id: a TD reorders and hides them, but never
# dissolves or renames one, so each id stays bound to the component that
# renders it. `fields` are the individually hideable pieces of a section that
# holds more than one — a section with none is all-or-nothing.
# ---------------------------------------------------------------------------
PANEL_SECTIONS: tuple[tuple[str, str, tuple[tuple[str, str], ...]], ...] = (
    ("membership", "Membership", (
        ("joined", "Joined"),
        ("join_method", "Join method"),
        ("roles", "Roles"),
        ("age", "Age"),
    )),
    ("availability", "Availability", ()),
    # The member's own staffing, laid out as a timeline per competition day.
    # Its one static field is the availability shading behind that timeline —
    # the assignments themselves are the section, not a field of it.
    ("assignments", "Assignments", (
        ("availability", "Availability shading"),
    )),
    ("lunch", "Lunch", (
        ("dietary_restriction", "Dietary restriction"),
    )),
    ("event_preferences", "Event Preferences", ()),
    ("education", "Education", (
        ("university", "University"),
        ("major", "Major"),
        ("year_level", "Year level"),
        ("graduation_year", "Graduation year"),
        ("employer", "Employer"),
    )),
    ("competition_experience", "Competition Experience", ()),
    ("volunteer_experience", "Volunteer Experience", ()),
    ("logistics", "Logistics", (
        ("shirt_size", "Shirt size"),
        ("dietary_restriction", "Dietary restriction"),
    )),
)

DEFAULT_SECTION_ORDER: tuple[str, ...] = tuple(section_id for section_id, _, _ in PANEL_SECTIONS)

# A TD-created section holding custom-form answers. Its id is
# "custom:{uuid}" — generated client-side on creation and stable thereafter,
# so reordering and renaming never orphan the fields assigned to it.
CUSTOM_SECTION_PREFIX = "custom:"

# The one custom section a tournament starts with: a catch-all holding every
# custom answer no other section claimed. Custom Responses used to be a
# built-in section, which made it the only part of the panel a TD couldn't
# rename or remove; as a seeded custom section it behaves like any other.
#
# Being a catch-all rather than an enumerated list is what keeps a question
# added to a form next month from being invisible until someone assigns it.
DEFAULT_CUSTOM_SECTION_ID = f"{CUSTOM_SECTION_PREFIX}all"

# Every entity namespace below is keyed by track now, matching the storage:
# availability, lunch and event preferences are all scoped to a track rather
# than to a date or a free-text suffix. Lunch keeps its category alongside,
# since one track asks about several (protein, drink, ...).
TRACK_NAMESPACE = "track:"
LUNCH_NAMESPACE = "lunch:"
EVENT_PREF_NAMESPACE = "event_pref:"
FORM_FIELD_NAMESPACE = "form_field:"
AVAILABILITY_TRACK_NAMESPACE = "availability_track:"

KNOWN_NAMESPACES = (
    TRACK_NAMESPACE,
    LUNCH_NAMESPACE,
    EVENT_PREF_NAMESPACE,
    FORM_FIELD_NAMESPACE,
    AVAILABILITY_TRACK_NAMESPACE,
)


def lunch_key(track_id: int, category: str) -> str:
    """One lunch pill: a track's category. Both parts are needed — Day 1's
    protein and Day 2's protein are different questions."""
    return f"{LUNCH_NAMESPACE}{track_id}:{category}"


def is_known_namespace(item: str) -> bool:
    return item.startswith(KNOWN_NAMESPACES)


def is_known_hidden_item(surface: str, item: str) -> bool:
    """Whether `surface` may hide `item`.

    Surface-scoped for the same reason is_known_column is: the belt card's
    hideable things are its own fields ("card_field:availability") and their
    per-track slices ("card_track:availability:3"), which mean nothing on a
    panel, while a panel's "track:3" means nothing on a card. Everything else
    keeps the shared namespace set.

    Track ids aren't checked against the catalog — a deleted track's saved
    entry is inert, the same leniency filter values already get.
    """
    if surface == ASSIGNMENT_CARD:
        if item.startswith(CARD_FIELD_NAMESPACE):
            return item[len(CARD_FIELD_NAMESPACE):] in ASSIGNMENT_CARD_FIELDS
        if item.startswith(CARD_TRACK_NAMESPACE):
            field, _, track = item[len(CARD_TRACK_NAMESPACE):].partition(":")
            return field in ASSIGNMENT_CARD_TRACK_SCOPED_FIELDS and track.isdigit()
        return False
    # An event row's hideable items are the tracks it runs on: hiding one
    # drops its shifts from the timeline, or its column from the no-shift
    # area. Its own metadata is `columns`, not `hidden`.
    if surface == ASSIGNMENTS_EVENTS:
        return item.startswith(TRACK_NAMESPACE)
    return is_known_namespace(item)


def unslug(text: str) -> str:
    """"test_review" -> "Test Review". Reserved-key suffixes and field_keys
    are slugs meant for lookup, never for a TD to read — every catalog label
    built from one goes through this."""
    return text.replace("_", " ").strip().title()


def is_known_column(surface: str, key: str) -> bool:
    """Whether `key` is a column `surface` can show.

    Surface-scoped because the two tables share no vocabulary: "division" is
    a real events column and a meaningless roster one. A surface with no
    columns at all (the panel, the member page) accepts none rather than
    falling through to another surface's set.

    On the roster a key is either one of the fixed ids or an entity the panel
    already namespaces — event_preference is excluded deliberately: a ranked
    list of events has no sensible single-cell rendering.
    """
    if surface == EVENTS_TABLE:
        return any(key == column_id for column_id, _ in EVENT_COLUMNS)
    if surface == ASSIGNMENTS_EVENTS:
        return key in ASSIGNMENT_EVENT_COLUMNS
    if surface != MEMBERS_TABLE:
        return False
    if any(key == column_id for column_id, _ in FIXED_COLUMNS):
        return True
    return key.startswith((
        TRACK_NAMESPACE, AVAILABILITY_TRACK_NAMESPACE, LUNCH_NAMESPACE, FORM_FIELD_NAMESPACE,
    ))


def known_filter_keys(surface: str) -> frozenset[str]:
    """The filter keys `surface` may store. Empty for a surface that has no
    filters, which makes any saved filter on it a 422 rather than dead
    weight nothing will ever read."""
    if surface == MEMBERS_TABLE:
        return KNOWN_FILTER_KEYS
    if surface == EVENTS_TABLE:
        return KNOWN_EVENT_FILTER_KEYS
    if surface == ASSIGNMENTS_EVENTS:
        return KNOWN_ASSIGNMENT_EVENT_FILTER_KEYS
    # The belt is filtered by the roster's own modal, so it stores the roster's
    # keys — see the note on ASSIGNMENT_CARD_FIELDS about why it is still its
    # own surface.
    if surface == ASSIGNMENT_CARD:
        return KNOWN_FILTER_KEYS
    return frozenset()


def known_sort_fields(surface: str) -> frozenset[str]:
    """The sort fields `surface` may store — same reasoning as
    known_filter_keys."""
    if surface == MEMBERS_TABLE:
        return KNOWN_SORT_FIELDS
    if surface == EVENTS_TABLE:
        return KNOWN_EVENT_SORT_FIELDS
    return frozenset()


def section_field_ids(section_id: str) -> frozenset[str]:
    """The individually hideable fields of a built-in section. Empty for a
    section that's all-or-nothing, and for any custom section."""
    for candidate_id, _, fields in PANEL_SECTIONS:
        if candidate_id == section_id:
            return frozenset(field_id for field_id, _ in fields)
    return frozenset()


def is_known_section(section_id: str) -> bool:
    return section_id in DEFAULT_SECTION_ORDER or section_id.startswith(CUSTOM_SECTION_PREFIX)


def build_catalog(db, tournament_id: int) -> dict[str, list[dict]]:
    """Every item a TD could choose to hide, grouped by kind, for the config
    modal (3.4) to render as toggles. Surface-agnostic — the universe of
    hideable items is the same regardless of which surface is being
    configured; only the saved `hidden` set differs per surface.

    Tracks come from the TournamentTrack catalog (the source of truth
    regardless of use). Lunch categories and event preference keys have no
    catalog table of their own, so they're derived from what's actually been
    submitted — the same data that would ever appear on a panel worth hiding
    something from. Custom fields reuse get_custom_form_answers' reserved-key
    exclusion, but tournament-wide rather than per-user."""
    from sqlalchemy import distinct
    from app.core.form.validation import TOURNAMENT_PRESET_FIELD_KEY_PATTERNS
    from app.core.tournament import tournament_local_date
    from app.models.models import (
        Form, FormField, Tournament, TournamentMembership, TournamentMembershipEventPreference,
        TournamentMembershipLunch, TournamentShift, TournamentTrack,
    )

    # Live tracks only: a pending-delete track is on its way out, so it is not
    # something to configure. Every track-keyed item below is narrowed to these.
    tracks = (
        db.query(TournamentTrack)
        .filter(TournamentTrack.tournament_id == tournament_id, TournamentTrack.is_archived.is_(False))
        .order_by(TournamentTrack.name)
        .all()
    )
    track_items = [{"key": f"{TRACK_NAMESPACE}{t.id}", "label": t.name} for t in tracks]

    track_names = {t.id: t.name for t in tracks}

    # The toggle hides a whole category on one track, so that pair is what it
    # must be labelled with — labelling it with one member's selection
    # ("Sofritas (Vegan)") named the wrong thing entirely.
    lunch_pairs = (
        db.query(distinct(TournamentMembershipLunch.track_id), TournamentMembershipLunch.category)
        .join(TournamentMembership, TournamentMembershipLunch.membership_id == TournamentMembership.id)
        .filter(TournamentMembership.tournament_id == tournament_id)
        .all()
    )
    lunch_items = [
        {
            "key": lunch_key(track_id, category),
            "label": f"{track_names[track_id]} \u2014 {unslug(category)}",
        }
        for track_id, category in sorted(lunch_pairs, key=lambda p: (track_names.get(p[0], ""), p[1]))
        if track_id in track_names
    ]

    event_pref_track_ids = (
        db.query(distinct(TournamentMembershipEventPreference.track_id))
        .join(TournamentMembership, TournamentMembershipEventPreference.membership_id == TournamentMembership.id)
        .filter(TournamentMembership.tournament_id == tournament_id)
        .all()
    )
    event_pref_items = [
        {"key": f"{EVENT_PREF_NAMESPACE}{track_id}", "label": track_names[track_id]}
        for (track_id,) in sorted(event_pref_track_ids, key=lambda p: track_names.get(p[0], ""))
        if track_id in track_names
    ]

    field_rows = (
        db.query(FormField, Form)
        .join(Form, FormField.form_id == Form.id)
        .filter(
            Form.owner_type == "tournament",
            Form.tournament_id == tournament_id,
            Form.status == "published",
        )
        .all()
    )
    # field_key, not the question label: the label is a whole sentence
    # ("What's your favorite color?"), and the form it came from doesn't
    # matter to a TD deciding whether the panel shows that answer.
    custom_field_items = [
        {"key": f"{FORM_FIELD_NAMESPACE}{field.id}", "label": unslug(field.field_key)}
        for field, _form in field_rows
        if not any(pattern.match(field.field_key) for pattern in TOURNAMENT_PRESET_FIELD_KEY_PATTERNS)
    ]

    # One item per track that has shifts. Was one per *day*, which is the
    # wrong unit now: two sites running the same Saturday are two separate
    # availability questions, and a day-keyed toggle would hide both at once.
    availability_track_ids = (
        db.query(distinct(TournamentShift.track_id))
        .filter(TournamentShift.tournament_id == tournament_id)
        .all()
    )
    availability_items = [
        {
            "key": f"{AVAILABILITY_TRACK_NAMESPACE}{track_id}",
            "label": track_names[track_id],
        }
        for (track_id,) in sorted(availability_track_ids, key=lambda p: track_names.get(p[0], ""))
        if track_id in track_names
    ]

    # Table columns: the fixed ones, then one per entity. Entity columns reuse
    # the same namespaced keys the panel hides by, so a key means the same
    # thing on both surfaces and the catalog never has to define it twice.
    # Unprefixed: a column header has room for a track name or a date, not for
    # "Track: " in front of it, and the config modal groups these under their
    # own headings anyway. The key still carries the namespace, so nothing
    # depends on the label to tell the kinds apart.
    column_items = (
        [{"key": key, "label": label} for key, label in FIXED_COLUMNS]
        + [{"key": item["key"], "label": item["label"]}
           for item in track_items + availability_items + lunch_items + custom_field_items]
    )

    # A section's own toggleable pieces are its static fields plus whatever
    # entities it actually renders — one entry per track, availability day,
    # lunch category and event-preference key, rather than a single
    # all-or-nothing switch over the lot.
    #
    # These entity entries keep their namespaced keys, which the surface's
    # `hidden` list already filters server-side (see apply_display_config) —
    # so offering them here needs no second filtering path, and the modal
    # writes them to `hidden` rather than to the section's hidden_fields.
    entity_fields = {
        "membership": track_items,
        # Tracks, not availability days: this section is laid out one timeline
        # per track, so a track is the thing you turn off.
        "assignments": track_items,
        "availability": availability_items,
        "lunch": lunch_items,
        "event_preferences": event_pref_items,
    }
    section_items = [
        {
            "id": section_id,
            "label": label,
            "fields": (
                [{"key": field_id, "label": field_label} for field_id, field_label in fields]
                + entity_fields.get(section_id, [])
            ),
        }
        for section_id, label, fields in PANEL_SECTIONS
    ]

    return {
        "tracks": track_items,
        "availability": availability_items,
        "lunch_categories": lunch_items,
        "event_preferences": event_pref_items,
        "custom_fields": custom_field_items,
        "columns": column_items,
        # Static, unlike every list above: an events column is a scalar on
        # the event, so nothing here depends on what this tournament holds.
        # Still served from the catalog rather than hardcoded in the client,
        # so the labels have one source.
        "event_columns": [{"key": key, "label": label} for key, label in EVENT_COLUMNS],
        "sections": section_items,
    }


def viewer_display_config(db, tournament_id: int, user_id: int) -> dict:
    """The config to render a tournament's surfaces with for one viewer.

    Empty for a viewer with no membership row in this tournament (a platform
    admin looking in from outside) — they read the defaults and have nowhere
    to save, which is the same answer as "saved nothing yet"."""
    from app.core.tournament.memberships import get_membership_by_user

    membership = get_membership_by_user(db, tournament_id, user_id)
    return (membership.display_config or {}) if membership else {}


def apply_display_config(config: dict | None, surface: str | None, data: dict, tournament) -> dict:
    """Drops hidden items from a serialized MembershipFullResponse dict for
    the given surface, per the *viewer's* config (see
    viewer_display_config) — not the tournament's, which no longer has one.
    `tournament` is still needed even though the config no longer lives on
    it: availability items key by tournament-local day, which only the
    tournament's timezone can resolve.

    Hidden items are omitted from the payload itself — not left for the
    client to filter — so stale data never crosses the wire. `surface=None`
    (no query param given) is a no-op: existing callers with no opinion on
    filtering get the unfiltered response.

    Deliberately independent of gate_age_flags: this must never become a
    second privacy mechanism. A TD un-hiding an age flag in display_config
    can't override a member's withheld consent — is_over_18/is_over_21
    aren't namespaced items this function even looks at."""
    if not surface:
        return data
    hidden = set((config or {}).get(surface, {}).get("hidden", []))
    if not hidden:
        return data

    # A section that renders unconditionally can't use "empty" to mean
    # "hidden" any more: an empty list is equally a member who never answered.
    # So record the sections filtering actually emptied — had rows going in,
    # none coming out — and let the panel drop exactly those.
    def _note_if_emptied(key: str, before: list) -> None:
        if before and not data.get(key):
            emptied.append(key)

    emptied: list[str] = []

    if "track_statuses" in data:
        data["track_statuses"] = [
            ts for ts in data["track_statuses"] if f"{TRACK_NAMESPACE}{ts['track_id']}" not in hidden
        ]
    if "availability" in data:
        before_availability = data["availability"]
        # Keyed by the shift's track, which the row carries outright — no
        # timezone conversion needed any more, unlike the day-keyed version
        # this replaced.
        data["availability"] = [
            row for row in data["availability"]
            if f"{AVAILABILITY_TRACK_NAMESPACE}{row['track_id']}" not in hidden
        ]
        _note_if_emptied("availability", before_availability)
    if "lunch" in data:
        before_lunch = data["lunch"]
        data["lunch"] = [
            row for row in before_lunch
            if lunch_key(row["track_id"], row["category"]) not in hidden
        ]
        _note_if_emptied("lunch", before_lunch)
    if "event_preferences" in data:
        before_prefs = data["event_preferences"]
        data["event_preferences"] = [
            pref for pref in before_prefs
            if f"{EVENT_PREF_NAMESPACE}{pref['track_id']}" not in hidden
        ]
        _note_if_emptied("event_preferences", before_prefs)
    if "custom_responses" in data:
        before_custom = data["custom_responses"]
        data["custom_responses"] = [
            row for row in before_custom if f"{FORM_FIELD_NAMESPACE}{row['field_id']}" not in hidden
        ]
        _note_if_emptied("custom_responses", before_custom)

    data["hidden_sections"] = emptied
    return data


# ---------------------------------------------------------------------------
# Surface -> field groups
#
# `surface` and `fields` do different jobs — fields selects what a response
# carries, surface filters what the viewer's saved config hides — but a
# surface implies its own answer to the first question: a table showing five
# columns needs exactly the groups those columns read.
#
# Deriving that here rather than making the client send it keeps one
# vocabulary in one place. The members page would otherwise have to
# reimplement this mapping and keep it in step with every column added.
# ---------------------------------------------------------------------------
_COLUMN_GROUPS: dict[str, tuple[str, ...]] = {
    COLUMN_EMAIL: ("contact",),
    COLUMN_PHONE: ("contact",),
    # account_age and joined read timestamps that are never in a group.
    COLUMN_ACCOUNT_AGE: (),
    COLUMN_JOINED: (),
    COLUMN_METHOD: ("membership",),
    COLUMN_AGE: ("age",),
    COLUMN_SHIRT_SIZE: ("profile",),
}

_NAMESPACE_GROUPS: tuple[tuple[str, str], ...] = (
    (TRACK_NAMESPACE, "tracks"),
    (LUNCH_NAMESPACE, "lunch"),
    (EVENT_PREF_NAMESPACE, "event_prefs"),
    (FORM_FIELD_NAMESPACE, "custom"),
    (AVAILABILITY_TRACK_NAMESPACE, "availability"),
)

# Panel/member-page sections and the groups each one renders. A section
# holding several kinds of thing pulls several groups — Membership shows join
# provenance, roles, age flags and track statuses in one block.
_SECTION_GROUPS: dict[str, tuple[str, ...]] = {
    "membership": ("membership", "roles", "age", "tracks"),
    "availability": ("availability",),
    # Availability rides along for the shading behind the timeline, which is
    # a field of this section rather than a section of its own.
    "assignments": ("assignments", "availability"),
    # dietary_restriction lives on the user profile, not on the lunch rows.
    "lunch": ("lunch", "profile"),
    "event_preferences": ("event_prefs",),
    "education": ("profile",),
    "competition_experience": ("profile",),
    "volunteer_experience": ("profile",),
    "logistics": ("profile",),
}


# The assignments board's member card. Fixed rather than TD-configurable:
# a card is roughly a business card of screen space with ~45 of them on a
# belt, and per issue #70 its face is name, event preferences with ranks, and
# a compressed experience summary — nothing else. Email and phone are
# deliberately out; there is no room, and neither informs an assignment.
#
# Identity (the name) is not a group, so it needs no entry here — see rule 3
# in field_groups.py.
_ASSIGNMENT_CARD_GROUPS = frozenset({"event_prefs", "tracks", "profile"})


def fields_for_surface(config: dict | None, surface: str | None) -> frozenset[str] | None:
    """The field groups `surface` needs, or None for "no opinion".

    None means the caller gets everything — same rule as an absent `fields`.
    Only the surfaces whose config actually enumerates what they show can
    narrow; anything else abstains rather than guessing.
    """
    # Not driven by saved config, unlike the three below: the card's face is
    # fixed by the issue, so there is nothing per-viewer to read.
    if surface == ASSIGNMENT_CARD:
        return _ASSIGNMENT_CARD_GROUPS

    if surface not in (MEMBERS_TABLE, MEMBERS_PANEL, MEMBER_PAGE):
        return None

    saved = (config or {}).get(surface) or {}

    if surface == MEMBERS_TABLE:
        columns = saved.get("columns")
        if columns is None:
            columns = list(DEFAULT_COLUMNS)
        # Name and roles are the row's identity and its controls — they are
        # not columns a TD can turn off (see FIXED_COLUMNS), so the table
        # always needs roles whatever the saved config says.
        groups = {"roles"}
        for column in columns:
            groups.update(_COLUMN_GROUPS.get(column, ()))
            for namespace, group in _NAMESPACE_GROUPS:
                if column.startswith(namespace):
                    groups.add(group)
        return frozenset(groups)

    # Panel and member page: every section renders unless hidden, and a
    # custom section holds custom answers.
    hidden = set(saved.get("hidden") or [])
    sections = saved.get("sections")
    section_ids = (
        [s.get("id") for s in sections if isinstance(s, dict)]
        if isinstance(sections, list)
        else list(DEFAULT_SECTION_ORDER) + [DEFAULT_CUSTOM_SECTION_ID]
    )

    # Contact is the panel's header, not one of its sections — the same way
    # roles is the table's row identity rather than a column. No section maps
    # to it, so deriving groups from the section list alone left the header
    # rendering an email and phone the payload never carried.
    groups: set[str] = {"contact"}
    for section_id in section_ids:
        if not section_id or section_id in hidden:
            continue
        if section_id.startswith(CUSTOM_SECTION_PREFIX):
            groups.add("custom")
            continue
        groups.update(_SECTION_GROUPS.get(section_id, ()))
    return frozenset(groups)
