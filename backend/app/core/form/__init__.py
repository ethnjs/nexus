import re
import secrets
from collections import Counter

from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import flag_modified

from app.core.form.validation import (
    AVAILABILITY_FIELD_KEY_PATTERN,
    EVENT_PREFERENCE_FIELD_KEY_PATTERN,
    TRACK_STATUS_FIELD_KEY_PATTERN,
    option_shift_ids,
    track_status_assignments,
)
from app.models.models import (
    Form,
    FormField,
    TournamentEvent,
    TournamentShift,
    TournamentTrack,
)


def slugify(text: str, max_len: int = 64) -> str:
    """Convert a TD-typed label into a snake_case field_key candidate."""
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug[:max_len]


# Types whose answer value references option_id(s) and so can be snapshotted
# at submission time (see snapshot_answer_value).
OPTION_BEARING_TYPES = {
    "single_select_radio",
    "single_select_dropdown",
    "multi_select_checkbox",
    "ranked_choice",
}


def _snapshot_option(options_by_id: dict, option_id) -> dict:
    if isinstance(option_id, dict) and isinstance(option_id.get("text"), str):
        # An Other pick, submitted as {option_id, text}: the typed text is the answer.
        option = options_by_id.get(option_id.get("option_id")) or {}
        text = option_id["text"].strip()
        return {
            "option_id": option_id.get("option_id"),
            "value": text,
            "label": option.get("label", "Other"),
            "text": text,
        }
    if not isinstance(option_id, str):
        return option_id
    option = options_by_id.get(option_id)
    if option is None:
        # Doesn't resolve against current config (stale/malformed submission)
        # — fall back to echoing the id as its own value/label rather than
        # dropping information.
        return {"option_id": option_id, "value": option_id, "label": option_id}
    return {"option_id": option["option_id"], "value": option["value"], "label": option["label"]}


def snapshot_answer_value(field: FormField, value):
    """Copies each picked option's value and label into a select-type answer
    at submission, so later edits to the option don't change how it reads.
    Returns `value` unchanged when it doesn't match the expected shape, since
    it's unvalidated input."""
    if field.question_type not in OPTION_BEARING_TYPES or value is None:
        return value

    options_by_id = {o["option_id"]: o for o in (field.config or {}).get("options", [])}

    if field.question_type == "multi_select_checkbox":
        return (
            [_snapshot_option(options_by_id, v) for v in value]
            if isinstance(value, list)
            else value
        )
    if field.question_type == "ranked_choice":
        return (
            {k: _snapshot_option(options_by_id, v) for k, v in value.items()}
            if isinstance(value, dict)
            else value
        )
    return _snapshot_option(options_by_id, value) if isinstance(value, (str, dict)) else value


def selected_option_ids(field: FormField, value) -> set:
    """Inverse-ish of snapshot_answer_value: pulls the set of option_ids a
    stored (already-snapshotted) or raw answer references, regardless of
    whether each item is a snapshot dict or a bare option_id string. Used
    to check a stored answer against a set of newly-archived option_ids."""
    if value is None:
        return set()
    if field.question_type == "ranked_choice":
        items = value.values() if isinstance(value, dict) else []
    elif isinstance(value, list):
        items = value
    else:
        items = [value]
    return {item.get("option_id") if isinstance(item, dict) else item for item in items}


def assign_option_ids(config: dict | None) -> dict | None:
    """The backend is the sole generator of option_id — the durable
    per-option identifier used for edit-lifecycle archiving, write-through,
    and branching match (see PlainOption/BranchingOption). Run on a
    field's raw submitted config before validate_field_config: an option
    that already carries a non-empty option_id (echoing what a prior GET
    returned for an option the TD kept) keeps it; an option with none
    (freshly added in this edit) gets a fresh one assigned here. No-op for
    configs without an `options` key."""
    if not config or "options" not in config:
        return config
    options = []
    for option in config["options"]:
        option = dict(option)
        if not option.get("option_id"):
            option["option_id"] = secrets.token_hex(5)
        options.append(option)
    return {**config, "options": options}


def track_referenced_by_form_field(db: Session, tournament_id: int, track_id: int) -> bool:
    """True when any field in the tournament is bound to ``track_id``.

    Track statuses store durable catalog IDs in each option's
    ``track_statuses`` list. Archived fields are intentionally included: they
    are historical form structure and deleting the catalog entry would leave
    them unresolved.
    """
    fields = (
        db.query(FormField)
        .join(Form, Form.id == FormField.form_id)
        .filter(Form.tournament_id == tournament_id)
        .all()
    )
    # A reserved key naming the track is a reference in its own right — an
    # availability_{track}/lunch_{track}/event_preference_{track} field points
    # at the track through its key, not through any option value.
    from app.core.form.validation import (
        availability_field_track_id,
        event_preference_field_track_id,
        lunch_field_track_id,
    )

    for field in fields:
        keyed = (
            availability_field_track_id(field.field_key)
            or event_preference_field_track_id(field.field_key)
            or lunch_field_track_id(field.field_key)
        )
        if keyed == track_id:
            return True
        if any(
            assignment.get("id") == track_id
            for assignment in track_status_assignments(field.config or {})
        ):
            return True
    return False


def _availability_fields(db: Session, tournament_id: int) -> list[FormField]:
    # `config` is plain JSON with no containment operators, so the shift lookup is a Python scan.
    fields = (
        db.query(FormField)
        .join(Form, Form.id == FormField.form_id)
        .filter(Form.tournament_id == tournament_id)
        .all()
    )
    return [field for field in fields if AVAILABILITY_FIELD_KEY_PATTERN.match(field.field_key)]


def count_options_with_shifts(db: Session, tournament_id: int, shift_ids: set[int]) -> Counter[int]:
    """How many availability options, live or archived, list each of `shift_ids`."""
    counts: Counter[int] = Counter()
    for field in _availability_fields(db, tournament_id):
        for option in (field.config or {}).get("options", []):
            counts.update(shift_ids.intersection(option_shift_ids(option)))
    return counts


def remove_shift_from_options(db: Session, tournament_id: int, shift_id: int) -> None:
    """Drops `shift_id` from every availability option, live or archived, on the
    tournament's forms. An option left with no shifts stays, as a "Can't make it" choice."""
    for field in _availability_fields(db, tournament_id):
        options = (field.config or {}).get("options", [])
        if not any(shift_id in option_shift_ids(option) for option in options):
            continue
        for option in options:
            value = option.get("value")
            if isinstance(value, dict):
                value["shift_ids"] = [i for i in value.get("shift_ids") or [] if i != shift_id]
            elif isinstance(value, list):
                option["value"] = [i for i in value if i != shift_id]
        flag_modified(field, "config")


def apply_option_archiving(old_config: dict | None, new_config: dict) -> tuple[dict, list[str]]:
    """For an in-place field update on a published form: an option_id
    present in the old config but absent from the submitted config is kept
    in storage with `is_archived: true` added, rather than dropped — a
    response referencing it must keep resolving. Returns the merged config
    and the option_ids newly archived by this call (empty if none, or if
    `old_config`/`new_config` isn't an options-bearing shape)."""
    old_options = (old_config or {}).get("options")
    if old_options is None or "options" not in new_config:
        return new_config, []

    new_ids = {o["option_id"] for o in new_config["options"]}
    newly_archived_ids: list[str] = []
    archived_options: list[dict] = []
    for option in old_options:
        if option["option_id"] not in new_ids:
            archived_options.append({**option, "is_archived": True})
            if not option.get("is_archived"):
                newly_archived_ids.append(option["option_id"])

    merged = dict(new_config)
    merged["options"] = [*new_config["options"], *archived_options]
    return merged, newly_archived_ids


def _resolve_track_statuses(db: Session, assignments: list[dict]) -> list[dict]:
    """Hydrate stored track ids into responder-facing track names.

    Track ids remain the durable builder representation; the normal form
    read includes names so a renderer never needs to make a separate catalog
    request. Preserve the configured mapping order rather than database order.
    """
    track_ids = [assignment.get("id") for assignment in assignments if isinstance(assignment, dict)]
    names_by_id = (
        {
            track_id: name
            for track_id, name in db.query(TournamentTrack.id, TournamentTrack.name)
            .filter(TournamentTrack.id.in_(track_ids))
            .all()
        }
        if track_ids
        else {}
    )
    return [
        {
            "id": assignment["id"],
            "name": names_by_id[assignment["id"]],
            "status": assignment["status"],
        }
        for assignment in assignments
        if isinstance(assignment, dict) and assignment.get("id") in names_by_id
    ]


def _resolve_availability_option(db: Session, option: dict) -> dict:
    """Responder-facing view of one availability option: `value` (normally
    the raw list[int] of grouped TournamentShift ids) is resolved in place
    into one `{id, label, start, end}` dict per shift — reusing `value`
    rather than inventing new keys, and keeping every underlying shift's own
    id/label/range intact (not collapsed into one combined range) so a
    builder UI can reconstruct exactly what's grouped, not just the result.
    `option_id` is what's actually submitted back on answer (see
    write-through, which resolves it server-side against the field's stored
    config, not this rendering)."""
    raw_value = option.get("value") or []
    has_track_statuses = isinstance(raw_value, dict)
    shift_ids = (raw_value.get("shift_ids") or []) if has_track_statuses else raw_value
    rows = (
        db.query(
            TournamentShift.id, TournamentShift.label, TournamentShift.start, TournamentShift.end
        )
        .filter(TournamentShift.id.in_(shift_ids))
        .order_by(TournamentShift.start)
        .all()
    )
    resolved_shifts = [
        {"id": shift_id, "label": label, "start": start, "end": end}
        for shift_id, label, start, end in rows
    ]
    resolved_value = (
        {
            "shifts": resolved_shifts,
            "track_statuses": _resolve_track_statuses(db, raw_value.get("track_statuses") or []),
        }
        if has_track_statuses
        else resolved_shifts
    )
    return {
        "option_id": option["option_id"],
        "label": option["label"],
        "value": resolved_value,
        # Only single_select_radio ever reaches here with these set (the
        # other allowed type, multi_select_checkbox, doesn't support
        # branching — see BRANCHING_QUESTION_TYPES) — carried through
        # unconditionally anyway so a respondent's branching walk sees the
        # same jump target the builder round-trips via raw=true. Omitting
        # them here was a bug: they used to just vanish from this response,
        # silently breaking branching for every availability field that had it.
        "next_field_id": option.get("next_field_id"),
        "action": option.get("action"),
    }


def _resolve_event_preference_option(db: Session, option: dict) -> dict:
    """Responder-facing view of one event_preference option: `value`
    (list[int] of grouped TournamentEvent ids) is resolved in place into one
    `{id, name, division}` dict per event — same "reuse value, one entry per
    grouped entity" treatment as availability. A `value` that's still a
    plain string (a single legacy id, per the Branching/Config-Validation
    issue's not-yet-strict event_preference validation) passes through
    unchanged rather than being resolved."""
    value = option.get("value")
    if not isinstance(value, list):
        return option

    # Whole rows rather than a column tuple: display_name has to fall back to
    # the joined catalog Event's name, which a bare TournamentEvent.name
    # select can't see.
    events = (
        db.query(TournamentEvent)
        .options(joinedload(TournamentEvent.event))
        .filter(TournamentEvent.id.in_(value))
        .order_by(TournamentEvent.id)
        .all()
    )
    return {
        "option_id": option["option_id"],
        "label": option["label"],
        "value": [{"id": e.id, "name": e.display_name, "division": e.division} for e in events],
        # See _resolve_availability_option's identical fields — same bug,
        # same fix. Only single_select_dropdown (of event_preference's three
        # allowed types) ever has these set.
        "next_field_id": option.get("next_field_id"),
        "action": option.get("action"),
    }


def resolve_field_options(db: Session, field: FormField) -> list[dict]:
    """Options for a given FormField, filtering out any `is_archived: true`
    option — archived options stay in `config` for historical answer/
    branching resolution but are never shown to a new respondent.

    Every option type (including reserved keys like event_preference,
    availability, lunch) is a stored, static list — "auto-load from
    tournament" conveniences (pulling in events/shifts/etc.) are a
    TD-editor-side action that populates this array once, same as any
    manually-authored option list, not a live server-side lookup. See
    backend/docs/form-question-types-reference.md's "Options-storage rule". availability
    and event_preference are the exceptions to "just return config as-is":
    when their `value` groups real entity ids (TournamentShifts,
    TournamentEvents), rendering resolves it into the actual entities
    instead of exposing raw ids."""
    config = dict(field.config or {})
    options = [o for o in config.get("options", []) if not o.get("is_archived")]

    if AVAILABILITY_FIELD_KEY_PATTERN.match(field.field_key):
        return [_resolve_availability_option(db, o) for o in options]
    if EVENT_PREFERENCE_FIELD_KEY_PATTERN.match(field.field_key):
        return [_resolve_event_preference_option(db, o) for o in options]
    if TRACK_STATUS_FIELD_KEY_PATTERN.match(field.field_key):
        return [
            {
                "option_id": option["option_id"],
                "label": option["label"],
                "value": _resolve_track_statuses(db, option.get("value") or []),
                # See _resolve_availability_option's identical fields — same
                # bug, same fix. Only single_select_radio (of track_status's
                # two allowed types) ever has these set.
                "next_field_id": option.get("next_field_id"),
                "action": option.get("action"),
            }
            for option in options
        ]

    return options
