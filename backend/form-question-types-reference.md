# Form Question Types Reference

Every `FormField` shares the same outer shape:

```json
{
  "id": 15,
  "form_id": 1,
  "question_type": "single_select_radio",
  "label": "...",
  "description": null,
  "field_key": "test_writing_interest",
  "config": { },
  "order": 4,
  "is_archived": false
}
```

`config` is type-specific — shapes below.

**`field_key` is required on every field, no exceptions.** The TD types a normal-language label for how they want the question to show up on their dashboard (e.g. "Test Writing Interest") and it's slugified into `field_key` (lowercase, alphanumeric + underscores, e.g. `test_writing_interest`) — this is what the TD sees when scanning/filtering responses later, not just an internal id. Must be unique **per tournament** — across every `Form` that tournament owns, not just within one form — so creating a field checks existing `field_key`s across all of that tournament's forms, including archived fields (an archived key isn't freed for reuse, to keep historical dashboard references unambiguous).

Reserved keys (`availability`, `lunch`, `event_preference`) are exact system-defined slugs. When a TD picks a reserved question type (e.g. `shift_select` for availability) from a preset/template, `field_key` should be locked to the reserved value rather than freely typed — otherwise a stray typo (`availibility`) silently breaks write-through with no error. Flagging this as the intended behavior, not yet confirmed.

**Options-storage rule:** wherever a type has an `options` array, each option is `{ "value": ..., "label": ... }` — `label` is what's shown, `value` is what's actually stored in `FormAnswer` (or referenced by write-through). Options are stored raw and literal — a resolved snapshot at creation/edit time, not a dynamic source reference. Editors may offer an "auto-load from tournament" convenience (events, categories, shifts) that populates this array once; after that it's just a normal static list like any other question's options. `value` is the stable identifier for edit-lifecycle purposes (renaming `label` is a safe in-place edit; old answers referencing `value` still resolve) — for options backed by a real entity (a `TournamentShift`, `TournamentEvent`, etc.) `value` is that entity's real id.

---

## `acknowledgment`
Single confirm checkbox, e.g. an age-verification notice.

```json
"config": { "required": true, "confirm_label": "I understand" }
```
Answer value: `true` (boolean; unanswered = not yet confirmed).
Branching: not supported.

## `single_select_radio`
Pick exactly one, shown as radio buttons.

```json
"config": {
  "required": true,
  "options": [
    { "value": "yes", "label": "Yes", "next_field_id": 15 },
    { "value": "no", "label": "No", "action": "submit_form" },
    { "value": "maybe", "label": "Maybe" }
  ]
}
```
Answer value: the chosen option's `value`.
Branching: supported — see Branching section below.

## `single_select_dropdown`
Same shape and behavior as `single_select_radio`, rendered as a dropdown instead of radio buttons. Used when the option list is long.
Branching: supported, identical mechanics.

## `multi_select_checkbox`
Pick any number, shown as checkboxes.

```json
"config": {
  "required": true,
  "options": [
    { "value": "anat_physio", "label": "Anatomy and Physiology" },
    { "value": "disease_detectives", "label": "Disease Detectives" }
  ]
}
```
Answer value: array of chosen option `value`s.
Branching: not supported (not single-select).

## `ranked_choice`
Rank a fixed number of options in order of preference.

```json
"config": {
  "required": true,
  "ranks": 3,
  "allow_duplicates": false,
  "options": [
    { "value": "te_anat_physio", "label": "Anatomy and Physiology" },
    { "value": "te_disease_detectives", "label": "Disease Detectives" }
  ]
}
```
Answer value: dict of rank → option `value`, e.g. `{"1": "te_anat_physio", "2": "te_disease_detectives"}`.
Branching: not supported.
Typical use: `field_key = "event_preference"`.

## `shift_select`
Pick from a TD-defined set of time windows. Options reference real `TournamentShift` rows (auto-loadable from the tournament's shift catalog), not free-typed ranges.

```json
"config": {
  "required": false,
  "options": [
    { "value": "1", "label": "Saturday, February 13, 2027" },
    { "value": "2", "label": "Saturday, February 20, 2027" }
  ]
}
```
Answer value: array of chosen `TournamentShift.id`s (the `value`s above).
Branching: not supported.
**Reserved:** this is the only question type allowed for `field_key = "availability"`. On submit, the answer write-throughs into `MembershipAvailability` (diffed against the prior submission) instead of being stored in `FormAnswer`.

## `short_text` / `long_text`
Free text — `short_text` single line, `long_text` multi-line.

```json
"config": { "required": false, "max_length": 500 }
```
Answer value: string.
Branching: not supported.

---

## Branching

Only `single_select_radio` and `single_select_dropdown` options may carry branching config:
- `next_field_id` — jump straight to that field, skipping everything in between.
- `action: "submit_form"` — end the flow immediately and submit whatever's been answered.
- Neither present — fall through to the next field in document `order` (the default case).

`next_field_id`/`action` are mutually exclusive per option, and `next_field_id` must reference an existing field in the same form. Next-field computation happens **client-side** — the frontend fetches the full field list once and walks the jump graph locally, no per-answer round trip. Multi-field loops (A→B→A) aren't currently guarded against — deferred until it's a real problem.

## Reserved `field_key`s

| `field_key` | Allowed `question_type`(s) | Write-through |
|---|---|---|
| `availability` | `shift_select` only | `MembershipAvailability` |
| `lunch` | single/multi-select (config shape still open — depends on `TournamentLunchOption` category/`allow_multiple` mapping, not yet designed for Forms) | `MembershipLunchSelection` |
| `event_preference` | `ranked_choice`, `multi_select_checkbox`, or `single_select_dropdown` | none — generic `FormAnswer` |
| any TD-typed slug | any type | none — generic `FormAnswer` |
