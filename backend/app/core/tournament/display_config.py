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
