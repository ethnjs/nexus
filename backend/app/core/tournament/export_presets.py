"""Vocabulary for saved export presets (#110). Rows are built client-side, so
the server only validates the recipe a preset stores."""

import re

# What one exported row is.
ROW_TYPES = frozenset({"member", "event", "assignment"})

# How a shift-like column (assigned shifts, availability) writes its values:
# shift names, or 24-hour ranges like "08:00-12:00".
COLUMN_MODES = frozenset({"names", "times"})

# Mirrors the column registry in frontend/lib/exports/columns.ts. Names shared
# with the members table mean the same thing there.
EXPORT_FIXED_COLUMNS = frozenset({
    "first_name", "last_name", "email", "phone", "shirt_size", "dietary_restriction",
    "roles", "over_18", "over_21",
    "event", "tracks", "assigned_role", "track", "shift",
})

# One column per entity. Ids aren't checked against the catalog: a deleted
# track's column is inert on read, same leniency as display config.
_EXPORT_ENTITY_COLUMN_PATTERN = re.compile(
    r"^("
    r"(track|availability_track|event_pref|track_events|track_roles|track_shifts):\d+"
    r"|lunch:\d+:[a-z0-9_]+"
    r"|form_field:[A-Za-z0-9_-]+"
    r")$"
)


def is_known_export_column(key: str) -> bool:
    return key in EXPORT_FIXED_COLUMNS or bool(_EXPORT_ENTITY_COLUMN_PATTERN.match(key))
