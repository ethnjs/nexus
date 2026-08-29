"""Shared constants for the per-tournament display_config JSON column (see
TASK.md Phase 3). Surface keys name a UI location; namespaced strings in a
surface's `hidden` list each identify one hideable item, e.g. "track:3".

Kept here (not inline in the route) so 3.3's apply-the-config step reuses the
same known sets rather than redefining them."""

MEMBERS_PANEL = "members_panel"
MEMBER_PAGE = "member_page"
ASSIGNMENT_CARD = "assignment_card"

KNOWN_SURFACES = frozenset({MEMBERS_PANEL, MEMBER_PAGE, ASSIGNMENT_CARD})

TRACK_NAMESPACE = "track:"
LUNCH_CATEGORY_NAMESPACE = "lunch_category:"
EVENT_PREF_NAMESPACE = "event_pref:"
FORM_FIELD_NAMESPACE = "form_field:"

KNOWN_NAMESPACES = (
    TRACK_NAMESPACE,
    LUNCH_CATEGORY_NAMESPACE,
    EVENT_PREF_NAMESPACE,
    FORM_FIELD_NAMESPACE,
)


def is_known_namespace(item: str) -> bool:
    return item.startswith(KNOWN_NAMESPACES)


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
    from app.models.models import (
        Form, FormField, TournamentMembership, TournamentMembershipEventPreference,
        TournamentMembershipLunch, TournamentTrack,
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

    # Ordered by id so which row's label wins a duplicate category is at
    # least deterministic (first submission), not DB-dependent — the label
    # is cosmetic either way, since `hidden` keys off category, not label.
    lunch_rows = (
        db.query(TournamentMembershipLunch.category, TournamentMembershipLunch.label)
        .join(TournamentMembership, TournamentMembershipLunch.membership_id == TournamentMembership.id)
        .filter(TournamentMembership.tournament_id == tournament_id)
        .order_by(TournamentMembershipLunch.id)
        .all()
    )
    seen_categories: set[str] = set()
    lunch_items = []
    for category, label in lunch_rows:
        if category in seen_categories:
            continue
        seen_categories.add(category)
        lunch_items.append({"key": f"{LUNCH_CATEGORY_NAMESPACE}{category}", "label": label})

    event_pref_keys = (
        db.query(distinct(TournamentMembershipEventPreference.key))
        .join(TournamentMembership, TournamentMembershipEventPreference.membership_id == TournamentMembership.id)
        .filter(TournamentMembership.tournament_id == tournament_id)
        .all()
    )
    event_pref_items = [
        {"key": f"{EVENT_PREF_NAMESPACE}{key}", "label": key} for (key,) in sorted(event_pref_keys)
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
    custom_field_items = [
        {"key": f"{FORM_FIELD_NAMESPACE}{field.id}", "label": f"{form.title or form.name}: {field.label}"}
        for field, form in field_rows
        if not any(pattern.match(field.field_key) for pattern in TOURNAMENT_PRESET_FIELD_KEY_PATTERNS)
    ]

    return {
        "tracks": track_items,
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

    if "track_statuses" in data:
        data["track_statuses"] = [
            ts for ts in data["track_statuses"] if f"{TRACK_NAMESPACE}{ts['track_id']}" not in hidden
        ]
    if "lunch" in data:
        data["lunch"] = [
            row for row in data["lunch"] if f"{LUNCH_CATEGORY_NAMESPACE}{row['category']}" not in hidden
        ]
    if "event_preferences" in data:
        data["event_preferences"] = [
            pref for pref in data["event_preferences"] if f"{EVENT_PREF_NAMESPACE}{pref['key']}" not in hidden
        ]
    if "custom_responses" in data:
        data["custom_responses"] = [
            row for row in data["custom_responses"] if f"{FORM_FIELD_NAMESPACE}{row['field_id']}" not in hidden
        ]
    return data
