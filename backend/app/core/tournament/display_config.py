"""Shared constants for the per-tournament display_config JSON column (see
TASK.md Phase 3). Surface keys name a UI location; namespaced strings in a
surface's `hidden` list each identify one hideable item, e.g. "track:3".

Kept here (not inline in the route) so 3.3's apply-the-config step reuses the
same known sets rather than redefining them."""

from datetime import datetime

from app.core.tournament import tournament_local_date

MEMBERS_PANEL = "members_panel"
MEMBER_PAGE = "member_page"
ASSIGNMENT_CARD = "assignment_card"

KNOWN_SURFACES = frozenset({MEMBERS_PANEL, MEMBER_PAGE, ASSIGNMENT_CARD})

TRACK_NAMESPACE = "track:"
LUNCH_CATEGORY_NAMESPACE = "lunch_category:"
EVENT_PREF_NAMESPACE = "event_pref:"
FORM_FIELD_NAMESPACE = "form_field:"
AVAILABILITY_DAY_NAMESPACE = "availability_day:"

KNOWN_NAMESPACES = (
    TRACK_NAMESPACE,
    LUNCH_CATEGORY_NAMESPACE,
    EVENT_PREF_NAMESPACE,
    FORM_FIELD_NAMESPACE,
    AVAILABILITY_DAY_NAMESPACE,
)


def is_known_namespace(item: str) -> bool:
    return item.startswith(KNOWN_NAMESPACES)


def unslug(text: str) -> str:
    """"test_review" -> "Test Review". Reserved-key suffixes and field_keys
    are slugs meant for lookup, never for a TD to read — every catalog label
    built from one goes through this."""
    return text.replace("_", " ").strip().title()


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

    tracks = (
        db.query(TournamentTrack)
        .filter(TournamentTrack.tournament_id == tournament_id)
        .order_by(TournamentTrack.name)
        .all()
    )
    track_items = [
        {"key": f"{TRACK_NAMESPACE}{t.id}", "label": f"{t.name} (archived)" if t.is_archived else t.name}
        for t in tracks
    ]

    # The toggle hides a whole category, so the category is what it must be
    # labelled with — labelling it with one member's selection ("Sofritas
    # (Vegan)") named the wrong thing entirely.
    lunch_categories = (
        db.query(distinct(TournamentMembershipLunch.category))
        .join(TournamentMembership, TournamentMembershipLunch.membership_id == TournamentMembership.id)
        .filter(TournamentMembership.tournament_id == tournament_id)
        .all()
    )
    lunch_items = [
        {"key": f"{LUNCH_CATEGORY_NAMESPACE}{category}", "label": unslug(category)}
        for (category,) in sorted(lunch_categories)
    ]

    event_pref_keys = (
        db.query(distinct(TournamentMembershipEventPreference.key))
        .join(TournamentMembership, TournamentMembershipEventPreference.membership_id == TournamentMembership.id)
        .filter(TournamentMembership.tournament_id == tournament_id)
        .all()
    )
    event_pref_items = [
        {"key": f"{EVENT_PREF_NAMESPACE}{key}", "label": unslug(key)} for (key,) in sorted(event_pref_keys)
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

    # One item per day the tournament runs shifts on, in the tournament's own
    # timezone — a shift's start is an instant, so a bare .date() would bucket
    # an early/late shift onto the neighbouring day for any non-UTC tournament.
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    shift_starts = (
        db.query(TournamentShift.start)
        .filter(TournamentShift.tournament_id == tournament_id)
        .all()
    )
    availability_days = sorted({tournament_local_date(tournament, start) for (start,) in shift_starts})
    availability_items = [
        # Built by hand rather than one strftime: "%-d" (no zero padding) is
        # a glibc extension that raises on Windows.
        {"key": f"{AVAILABILITY_DAY_NAMESPACE}{day.isoformat()}", "label": f"{day.strftime('%a, %b')} {day.day}"}
        for day in availability_days
    ]

    return {
        "tracks": track_items,
        "availability": availability_items,
        "lunch_categories": lunch_items,
        "event_preferences": event_pref_items,
        "custom_fields": custom_field_items,
    }


def apply_display_config(tournament, surface: str | None, data: dict) -> dict:
    """Drops hidden items from a serialized MembershipFullResponse dict for
    the given surface. Hidden items are omitted from the payload itself —
    not left for the client to filter — so stale data never crosses the
    wire. `surface=None` (no query param given) is a no-op: existing
    callers with no opinion on filtering get the unfiltered response.

    Deliberately independent of gate_age_flags: this must never become a
    second privacy mechanism. A TD un-hiding an age flag in display_config
    can't override a member's withheld consent — is_over_18/is_over_21
    aren't namespaced items this function even looks at."""
    if not surface:
        return data
    hidden = set((tournament.display_config or {}).get(surface, {}).get("hidden", []))
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
        # `start` is a serialized instant; the item keys are tournament-local
        # days, so it has to go back through the same conversion build_catalog
        # used rather than a naive [:10] slice of the ISO string.
        data["availability"] = [
            row for row in data["availability"]
            if f"{AVAILABILITY_DAY_NAMESPACE}"
            f"{tournament_local_date(tournament, datetime.fromisoformat(row['start'])).isoformat()}" not in hidden
        ]
        _note_if_emptied("availability", before_availability)
    if "lunch" in data:
        before_lunch = data["lunch"]
        data["lunch"] = [
            row for row in before_lunch if f"{LUNCH_CATEGORY_NAMESPACE}{row['category']}" not in hidden
        ]
        _note_if_emptied("lunch", before_lunch)
    if "event_preferences" in data:
        before_prefs = data["event_preferences"]
        data["event_preferences"] = [
            pref for pref in before_prefs if f"{EVENT_PREF_NAMESPACE}{pref['key']}" not in hidden
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
