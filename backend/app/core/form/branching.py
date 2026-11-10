"""Server-side branching replay for form submissions — mirrors the
client-side jump-graph walk (see backend/docs/form-question-types-reference.md) so
`required` is enforced only on fields the respondent could actually reach,
independent of whatever the client computed."""

from typing import Any

from app.core.form.validation import BRANCHING_QUESTION_TYPES
from app.models.models import FormField


def compute_reachable_field_ids(fields: list[FormField], answers: dict[str, Any]) -> set[str]:
    """`fields` must be every non-archived field on the form, any order.
    `answers` maps field_id -> submitted value. Walks from the
    lowest-`order` field, following each branching option's
    `next_field_id`/`action` for the field's submitted answer, falling
    through to the next field by `order` otherwise. Returns the set of
    field ids visited. A revisited field ends the walk: jumps are
    forward-only now, but forms saved before that rule can still loop."""
    if not fields:
        return set()

    by_order = sorted(fields, key=lambda f: f.order)
    by_id = {f.id: f for f in fields}

    reachable: set[str] = set()
    current: FormField | None = by_order[0]

    while current is not None and current.id not in reachable:
        reachable.add(current.id)

        next_field: FormField | None = None
        if current.question_type in BRANCHING_QUESTION_TYPES:
            answer = answers.get(current.id)
            if isinstance(answer, dict):  # an Other pick
                answer = answer.get("option_id")
            options = (current.config or {}).get("options", [])
            matched = next((o for o in options if o.get("option_id") == answer), None)
            if matched is not None:
                if matched.get("action") == "submit_form":
                    return reachable
                next_field_id = matched.get("next_field_id")
                if next_field_id is not None:
                    next_field = by_id.get(next_field_id)

        if next_field is None:
            idx = by_order.index(current)
            next_field = by_order[idx + 1] if idx + 1 < len(by_order) else None

        current = next_field

    return reachable


def _is_blank(value: Any) -> bool:
    """No answer given, or an empty/false one — treated the same as
    "not answered" for `required` enforcement (e.g. an unconfirmed
    acknowledgment submits `false`, not an absent key)."""
    if value is None or value is False:
        return True
    if isinstance(value, (str, list, dict)) and len(value) == 0:
        return True
    return False


def missing_required_field_keys(fields: list[FormField], answers: dict[str, Any]) -> list[str]:
    """field_keys of reachable, required fields left blank in `answers`."""
    reachable = compute_reachable_field_ids(fields, answers)
    return [
        field.field_key
        for field in fields
        if field.id in reachable
        and (field.config or {}).get("required")
        and _is_blank(answers.get(field.id))
    ]


OTHER_TEXT_MAX_LENGTH = 500
OTHER_QUESTION_TYPES = {"single_select_radio", "single_select_dropdown", "multi_select_checkbox"}


def invalid_other_answer_field_keys(fields: list[FormField], answers: dict[str, Any]) -> list[str]:
    """field_keys whose answer picks an Other option without typed text (or
    with too much), or sends text for an option that isn't Other."""
    offenders = []
    for field in fields:
        if field.question_type not in OTHER_QUESTION_TYPES or field.id not in answers:
            continue
        value = answers[field.id]
        items = value if isinstance(value, list) else [value]
        other_ids = {
            o.get("option_id") for o in (field.config or {}).get("options", []) if o.get("is_other")
        }
        for item in items:
            if isinstance(item, dict):
                text = item.get("text")
                valid = (
                    item.get("option_id") in other_ids
                    and isinstance(text, str)
                    and 0 < len(text.strip()) <= OTHER_TEXT_MAX_LENGTH
                )
            else:
                valid = item not in other_ids
            if not valid:
                offenders.append(field.field_key)
                break
    return offenders


def duplicate_ranked_choice_field_keys(
    fields: list[FormField], answers: dict[str, Any]
) -> list[str]:
    """field_keys of ranked_choice fields whose answer repeats the same
    option_id at more than one rank, for a field whose config doesn't allow
    it. `allow_duplicates` is a required RankedChoiceConfig field, but until
    now nothing server-side actually read it — only the picker UI
    (RankedList.tsx) used it client-side to trim its remaining-options pool.
    This is the enforcement that makes it real."""
    offenders = []
    for field in fields:
        if field.question_type != "ranked_choice" or (field.config or {}).get("allow_duplicates"):
            continue
        value = answers.get(field.id)
        if not isinstance(value, dict):
            continue
        option_ids = list(value.values())
        if len(option_ids) != len(set(option_ids)):
            offenders.append(field.field_key)
    return offenders
