"""Classifying what a field edit means for people who already answered it.

The TD sends a target field list; this works out, per field, whether anyone
must be asked to look at their answer again and why. See
backend/form-edit-lifecycle.md for the rules these implement.

Two tiers:
  * MANDATORY_REASONS always apply — the change invalidates or outdates an
    existing answer, and the TD can't suppress the prompt.
  * OPTIONAL_REASONS are judgment calls the TD makes per field at save time.
    Each carries a default for when the caller doesn't say.
"""
from app.core.form.validation import (
    AVAILABILITY_FIELD_KEY_PATTERN,
    EVENT_PREFERENCE_FIELD_KEY_PATTERN,
    LUNCH_FIELD_KEY_PATTERN,
    TRACK_STATUS_FIELD_KEY_PATTERN,
)

# Answer storage shape per question_type. A type change only matters when it
# moves between classes — radio -> dropdown is a rendering choice and leaves
# every stored answer valid, while radio -> checkbox turns one snapshot into a
# list of them.
SHAPE_CLASSES: dict[str, str] = {
    "short_text": "text",
    "long_text": "text",
    "single_select_radio": "single_select",
    "single_select_dropdown": "single_select",
    "multi_select_checkbox": "multi",
    "ranked_choice": "ranked",
    "acknowledgment": "bool",
}

QUESTION_TYPE_CHANGED = "question_type_changed"
OPTION_ADDED = "option_added"
OPTION_INVALIDATED = "option_invalidated"
NOW_REQUIRED = "now_required"
KEY_CHANGED = "key_changed"
TEXT_CHANGED = "text_changed"

MANDATORY_REASONS = frozenset({QUESTION_TYPE_CHANGED, OPTION_ADDED, OPTION_INVALIDATED, NOW_REQUIRED})

# Default for each judgment call when the caller doesn't send one. key_changed
# defaults on because the consequence of skipping it is invisible: those
# responders simply never reach the write-through tables, with no error and no
# empty state to notice.
OPTIONAL_REASON_DEFAULTS: dict[str, bool] = {
    KEY_CHANGED: True,
    TEXT_CHANGED: False,
}

_PRESET_PATTERNS = (
    AVAILABILITY_FIELD_KEY_PATTERN,
    EVENT_PREFERENCE_FIELD_KEY_PATTERN,
    LUNCH_FIELD_KEY_PATTERN,
    TRACK_STATUS_FIELD_KEY_PATTERN,
)


def is_preset_key(field_key: str) -> bool:
    return any(pattern.match(field_key) for pattern in _PRESET_PATTERNS)


def shape_class(question_type: str) -> str | None:
    return SHAPE_CLASSES.get(question_type)


def _option_ids(config: dict | None) -> set[str]:
    """Live option ids only — an archived option isn't offered to anyone, so
    it can't be what a respondent 'gained' or 'lost'."""
    return {
        option["option_id"]
        for option in (config or {}).get("options") or []
        if not option.get("is_archived")
    }


def _labels_by_option_id(config: dict | None) -> dict[str, str]:
    return {
        option["option_id"]: option.get("label")
        for option in (config or {}).get("options") or []
    }


def classify_field_change(
    old_field,
    new_question_type: str,
    new_field_key: str,
    new_config: dict | None,
    new_label: str,
    new_description: str | None,
) -> set[str]:
    """Every reason this edit raises, mandatory and optional together. The
    caller decides which optional ones survive — see resolve_reasons."""
    reasons: set[str] = set()
    old_config = old_field.config or {}

    shape_changed = shape_class(new_question_type) != shape_class(old_field.question_type)
    if shape_changed:
        reasons.add(QUESTION_TYPE_CHANGED)

    # Options are only comparable within a shape class — a text field has none
    # to diff against, and across classes the whole answer is invalid anyway.
    # Reporting "an option was added" alongside the type change would be noise
    # describing a consequence of it, not a separate thing to review.
    if not shape_changed:
        old_ids, new_ids = _option_ids(old_config), _option_ids(new_config)
        if new_ids - old_ids:
            reasons.add(OPTION_ADDED)
        if old_ids - new_ids:
            reasons.add(OPTION_INVALIDATED)

    if new_config and new_config.get("required") and not old_config.get("required"):
        reasons.add(NOW_REQUIRED)

    if is_preset_key(new_field_key) != is_preset_key(old_field.field_key):
        reasons.add(KEY_CHANGED)

    old_labels = _labels_by_option_id(old_config)
    new_labels = _labels_by_option_id(new_config)
    label_changed = any(
        option_id in old_labels and old_labels[option_id] != label
        for option_id, label in new_labels.items()
    )
    if new_label != old_field.label or new_description != old_field.description or label_changed:
        reasons.add(TEXT_CHANGED)

    return reasons


def resolve_reasons(reasons: set[str], notify: bool | None) -> set[str]:
    """Drop the optional reasons the TD declined. `notify` is their answer for
    this field: None means they didn't say, so each optional reason falls back
    to its own default. Mandatory reasons are never affected."""
    kept = {reason for reason in reasons if reason in MANDATORY_REASONS}
    for reason in reasons - MANDATORY_REASONS:
        if notify if notify is not None else OPTIONAL_REASON_DEFAULTS.get(reason, False):
            kept.add(reason)
    return kept
