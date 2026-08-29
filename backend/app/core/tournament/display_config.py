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
