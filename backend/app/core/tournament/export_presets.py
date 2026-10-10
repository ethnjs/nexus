"""Vocabulary for saved export presets (#110). Rows are built client-side, so
the server only validates the recipe a preset stores."""

import re

# What one exported row is.
ROW_TYPES = frozenset({"member", "event", "assignment"})

# How a shift-like column (assigned shifts, availability) writes its values:
# shift names, or 24-hour ranges like "08:00-12:00".
COLUMN_MODES = frozenset({"names", "times"})

# A bare name ("email") or a namespaced one ("track:3", "form_field:12").
_COLUMN_KEY_PATTERN = re.compile(r"^[a-z_]+(:[A-Za-z0-9_-]+)*$")


def is_known_export_column(key: str) -> bool:
    """Whether `key` can name an export column.

    Shape only for now: the export-only names (per-track events, roles,
    shifts) are settled with the column registry, and this tightens then.
    """
    return bool(_COLUMN_KEY_PATTERN.match(key))
