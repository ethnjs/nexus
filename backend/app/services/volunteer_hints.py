"""
Volunteer header hints — maps lowercase substrings in sheet column headers
to volunteer field names (and optional extra_keys).

Hints predict FIELD only, never type. Type is determined by:
  1. Form question google_type → FORMS_TYPE_MAP (when form data available)
  2. Default to "string" (when no form data)
  3. Exception: availability bracket pattern → "matrix_row"

More specific patterns must come before general ones — first match wins.

This module is volunteer-specific. When events import lands, a parallel
event_hints.py will be created with its own hint table.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class FieldHint:
    """A single hint entry: which field (and optional extra_key) a header maps to."""
    field: str
    extra_key: str | None = None


# Sentinel for headers that should be ignored
IGNORE_HINT = FieldHint(field="__ignore__")

# ---------------------------------------------------------------------------
# Volunteer header hints table.
# Each entry: (lowercase_substring, FieldHint)
#
# Order matters — first match wins. More specific patterns before general ones.
# ---------------------------------------------------------------------------
VOLUNTEER_HINTS: list[tuple[str, FieldHint]] = [
    # ── Name ──────────────────────────────────────────────────────────────
    # "First & Last Name" must come before "first name" / "last name"
    ("first & last name",   FieldHint(field="full_name")),
    ("full name",           FieldHint(field="full_name")),
    ("first name",          FieldHint(field="first_name")),
    ("last name",           FieldHint(field="last_name")),

    # ── Contact ───────────────────────────────────────────────────────────
    ("email",               FieldHint(field="email")),
    ("phone",               FieldHint(field="phone")),

    # ── Clothing ──────────────────────────────────────────────────────────
    ("t-shirt",             FieldHint(field="shirt_size")),
    ("shirt",               FieldHint(field="shirt_size")),

    # ── Dietary ───────────────────────────────────────────────────────────
    ("dietary",             FieldHint(field="dietary_restriction")),
    ("food allerg",         FieldHint(field="dietary_restriction")),
    ("allerg",              FieldHint(field="dietary_restriction")),

    # ── University / employer / major ─────────────────────────────────────
    ("current employer",    FieldHint(field="employer")),
    ("employer or university", FieldHint(field="employer")),
    ("employer",            FieldHint(field="employer")),
    ("university",          FieldHint(field="university")),
    ("field of study",      FieldHint(field="major")),
    ("major",               FieldHint(field="major")),

    # ── Student status ────────────────────────────────────────────────────
    ("what year are you",   FieldHint(field="student_status")),
    ("i am a",              FieldHint(field="student_status")),

    # ── Role & preference ─────────────────────────────────────────────────
    ("volunteering role preference", FieldHint(field="role_preference")),
    ("volunteering role",            FieldHint(field="role_preference")),
    ("role preference",              FieldHint(field="role_preference")),

    # Event preference — more specific patterns first
    ("if interested in event",       FieldHint(field="event_preference")),
    ("interested in supervising",    FieldHint(field="event_preference")),
    ("which event",                  FieldHint(field="event_preference")),
    ("event preference",             FieldHint(field="event_preference")),
    ("top 3 events",                 FieldHint(field="event_preference")),
    ("select the top",               FieldHint(field="event_preference")),

    # General volunteer interest — extra_data
    ("if you are interested in general", FieldHint(field="extra_data", extra_key="general_volunteer_interest")),
    ("general volunteer",                FieldHint(field="extra_data", extra_key="general_volunteer_interest")),

    # ── Availability ──────────────────────────────────────────────────────
    # Catch-all for availability headers that don't match the bracket regex.
    # e.g. "Will you be available for the full day"
    ("available for the full day", FieldHint(field="availability")),
    ("availability",               FieldHint(field="availability")),

    # ── Lunch / food ──────────────────────────────────────────────────────
    ("protein",             FieldHint(field="lunch_order")),
    ("burrito",             FieldHint(field="lunch_order")),
    ("would you like to drink", FieldHint(field="lunch_order")),
    ("lunch",               FieldHint(field="lunch_order")),
    ("meal",                FieldHint(field="lunch_order")),
    ("entrée",              FieldHint(field="lunch_order")),
    ("entree",              FieldHint(field="lunch_order")),
    ("dish",                FieldHint(field="lunch_order")),
    ("dessert",             FieldHint(field="lunch_order")),
    ("drink",               FieldHint(field="lunch_order")),

    # ── Science Olympiad experience ───────────────────────────────────────
    ("competed in the past",    FieldHint(field="competition_exp")),
    ("competed in science",     FieldHint(field="competition_exp")),
    ("experience with science olympiad", FieldHint(field="competition_exp")),
    ("events competed in",      FieldHint(field="competition_exp")),
    ("schools you represented", FieldHint(field="competition_exp")),

    ("volunteered for past",    FieldHint(field="volunteering_exp")),
    ("volunteered for",         FieldHint(field="volunteering_exp")),
    ("volunteered in the past", FieldHint(field="volunteering_exp")),
    ("describe your experience", FieldHint(field="volunteering_exp")),
    ("expertise",               FieldHint(field="volunteering_exp")),

    # ── Transportation & logistics ────────────────────────────────────────
    ("coming from",             FieldHint(field="extra_data", extra_key="location")),
    ("which area",              FieldHint(field="extra_data", extra_key="location")),
    ("conflict of interest",    FieldHint(field="extra_data", extra_key="conflict_of_interest")),
    ("how many people can you take", FieldHint(field="extra_data", extra_key="carpool_seats")),
    ("need transportation",     FieldHint(field="extra_data", extra_key="transportation")),
    ("how will you get",        FieldHint(field="extra_data", extra_key="transportation")),

    # ── Notes / limitations / misc ────────────────────────────────────────
    ("limitation",              FieldHint(field="notes")),
    ("questions or comments",   FieldHint(field="notes")),
    ("additional",              FieldHint(field="notes")),
    ("notes",                   FieldHint(field="notes")),
    ("work with",               FieldHint(field="notes")),
    ("question",                FieldHint(field="extra_data", extra_key="comments")),
    ("comment",                 FieldHint(field="extra_data", extra_key="comments")),

    # ── Confirmation ──────────────────────────────────────────────────────
    ("i will volunteer",        FieldHint(field="extra_data", extra_key="confirmed")),
    ("verify your age",         FieldHint(field="extra_data", extra_key="age_verified")),
    ("over the age of",         FieldHint(field="extra_data", extra_key="age_verified")),

    # ── Always ignore ─────────────────────────────────────────────────────
    ("timestamp",               IGNORE_HINT),
    ("how did you hear",        IGNORE_HINT),
]

# Pattern for availability grid columns: "Availability [8:00 AM - 10:00 AM]"
# Also handles: "Availability from 5/21 to 5/23 [8:00 AM - 10:00 AM]"
AVAILABILITY_BRACKET_PATTERN = re.compile(r"availability.+\[(.+)\]", re.IGNORECASE)

# Per-field ordered (keyword, row_key) tables for multi-header matrix_row upgrade.
# A field listed here opts in to automatic aggregation: when 2+ headers hint to
# the same field, they are promoted to type="matrix_row" with inferred row_keys.
# To support a new aggregatable field, add an entry here.
MATRIX_ROW_KEY_KEYWORDS: dict[str, list[tuple[str, str]]] = {
    "lunch_order": [
        ("protein",  "protein"),
        ("burrito",  "burrito"),
        ("drink",    "drink"),
        ("entrée",   "entree"),
        ("entree",   "entree"),
        ("dessert",  "dessert"),
        ("dish",     "dish"),
        ("meal",     "meal"),
        ("lunch",    "lunch"),
    ],
}


def match_volunteer_hint(header_lower: str) -> FieldHint | None:
    """
    Match a lowercase header string against the volunteer hints table.
    Returns the FieldHint if matched, None otherwise.

    Does NOT handle the availability bracket pattern — callers should
    check AVAILABILITY_BRACKET_PATTERN first.
    """
    for pattern, hint in VOLUNTEER_HINTS:
        if pattern in header_lower:
            return hint
    return None