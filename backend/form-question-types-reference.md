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

**Line between `question_type` and `field_key`:** `question_type` is purely structural — how the question is rendered and answered. `field_key` is semantic — when it's a reserved key (`availability`, `event_preference`, `lunch_{custom}`), it changes how a *structurally normal* field's options/answers get parsed and, for tournament forms, written through to a structural table. Reserved keys don't get their own `question_type` — they reuse the existing structural types and layer extra validation on top. When a TD picks a reserved-key preset/template, `field_key` should be locked to the reserved value rather than freely typed — otherwise a stray typo (`availibility`) silently breaks write-through with no error. Flagging this as the intended behavior, not yet confirmed.

**Options-storage rule:** wherever a type has an `options` array, each option is `{ "option_id": ..., "value": ..., "label": ..., "is_archived": false }`:
- `option_id` — system-generated, opaque, required, and the **sole stable identifier**: what a submitted answer actually references, what branching matches against, and what Edit Lifecycle diffs/archives by (see "Reserved `field_key`s" and the Edit Lifecycle section below). Never client-authored; a create/update request may omit it (new option) or echo back one from a prior `GET` (existing option, kept stable).
- `value` — normally TD-facing display text (typically a shortened version of `label`). For an entity-backed reserved `field_key` (`availability` grouping `TournamentShift`s, `event_preference` grouping `TournamentEvent`s), it's instead `list[int]` — the real ids of the underlying entities this option groups together — and the client is responsible for interpreting which shape to expect based on `field_key`. A bare `list[int]` for `event_preference` is resolved on render (see below); a legacy plain-string `value` there passes through unresolved.
- `label` — responder-facing display text.
- `is_archived` — set by the server during a published-form republish (see Edit Lifecycle); an archived option is dropped from what a new respondent sees/can select, but stays in storage so a past answer referencing its `option_id` still resolves.

Options are stored raw and literal — a resolved snapshot at creation/edit time, not a dynamic source reference. Editors may offer an "auto-load from tournament" convenience (events, shifts) that populates `value`'s entity-id list once; after that it's just a normal static list like any other question's options, no live server-side lookup involved.

**Answer-value snapshotting:** for any option-bearing type except `availability` (still on its own raw-shift-id submission path, see below), `FormAnswer.value` doesn't store a bare `option_id` — it stores a `{ "option_id": ..., "value": ..., "label": ... }` snapshot captured at submission time (a list of snapshots for `multi_select_checkbox`, a rank→snapshot dict for `ranked_choice`). This means a later edit to an option's `value`/`label` (TD-editable text, unlike `option_id`) never retroactively changes how a past answer displays — see `FormResponsePendingUpdate` below for how a TD/respondent actually finds out something changed.

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
    { "option_id": "a1b2c3d4e5", "value": "yes", "label": "Yes", "next_field_id": 15 },
    { "option_id": "f6e5d4c3b2", "value": "no", "label": "No", "action": "submit_form" },
    { "option_id": "7g8h9i0j1k", "value": "maybe", "label": "Maybe" }
  ]
}
```
Answer value: the chosen option's `option_id` — stored as a `{option_id, value, label}` snapshot (see "Answer-value snapshotting" above).
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
    { "option_id": "a1b2c3d4e5", "value": "anat_physio", "label": "Anatomy and Physiology" },
    { "option_id": "f6e5d4c3b2", "value": "disease_detectives", "label": "Disease Detectives" }
  ]
}
```
Answer value: array of chosen option `option_id`s — stored as a list of `{option_id, value, label}` snapshots.
Branching: not supported (not single-select).

**Reserved-key note (`availability`):** `field_key = "availability"` is allowed on either `single_select_radio` or `multi_select_checkbox` — the TD's choice of type determines whether a respondent can select more than one grouped option at once (multi-select, e.g. "free both Morning and Evening but not Afternoon") or at most one (single-select, for a tournament that only wants one blanket answer per person); it doesn't change write-through, only how many options can be selected. Each option's stored `value` is `list[int]` — one or more real `TournamentShift` ids belonging to the field's tournament, grouped under a single TD-labeled choice (e.g. `"All Day"` → `[1, 2, 3]`), auto-loadable from the tournament's shift catalog. `GET`-rendering resolves `value` in place (`resolve_field_options`'s availability branch) from that raw id list into one `{id, label, start, end}` entry per shift, ordered by `start` — reusing `value` rather than inventing new keys, and keeping every underlying shift's own id/label/range intact (not collapsed into one combined range) so an editor can see exactly what's grouped:

```json
{ "option_id": "a1b2c3d4e5", "label": "All Day", "value": [
  { "id": 1, "label": "Morning", "start": "2027-02-13T07:00:00Z", "end": "2027-02-13T12:00:00Z" },
  { "id": 2, "label": "Afternoon", "start": "2027-02-13T12:00:00Z", "end": "2027-02-13T16:00:00Z" }
] }
```

On submit, the answer's selected option_id(s) are expanded into their grouped shift ids (deduped via set union across selections) and write-through into `MembershipAvailability` (diffed against the prior submission) — this fires only on tournament-owned forms; on a chapter-owned form the same field is valid but stores as a normal `FormAnswer`, no write-through. Availability answers are **not** snapshotted the way other option types are (see "Answer-value snapshotting" above) — `FormAnswer.value` stores the raw selected `option_id`(s) directly. Deleting a `TournamentShift` is rejected if it's referenced either by an existing `MembershipAvailability` row, or inside any non-archived field's option `value` list — a shift that's part of a live option's grouping can't be pulled out from under it even before anyone's answered.

## `ranked_choice`
Rank a fixed number of options in order of preference.

```json
"config": {
  "required": true,
  "ranks": 3,
  "allow_duplicates": false,
  "options": [
    { "option_id": "a1b2c3d4e5", "value": "te_anat_physio", "label": "Anatomy and Physiology" },
    { "option_id": "f6e5d4c3b2", "value": "te_disease_detectives", "label": "Disease Detectives" }
  ]
}
```
Answer value: dict of rank → option `option_id`, e.g. `{"1": "a1b2c3d4e5", "2": "f6e5d4c3b2"}` — stored as rank → `{option_id, value, label}` snapshot.
Branching: not supported.

**Reserved-key note (`event_preference`):** allowed on this type, `multi_select_checkbox`, or `single_select_dropdown`. An option's stored `value` may be `list[int]` — one or more real `TournamentEvent` ids grouped under a single label (the same grouping pattern as availability's shift ids), auto-loadable from the tournament's event catalog. `GET`-rendering resolves `value` in place into one `{id, name, division}` entry per event, ordered by id (`resolve_field_options`'s event_preference branch) — same "reuse `value`, one entry per grouped entity" treatment as availability:

```json
{ "option_id": "a1b2c3d4e5", "label": "Life Science", "value": [{ "id": 5, "name": "Anatomy and Physiology", "division": "B" }, { "id": 9, "name": "Disease Detectives", "division": "C" }] }
```

A `value` that's still a plain string (a single legacy id) passes through unresolved — strict validation that every `event_preference` option's ids are real `TournamentEvent`s isn't built yet, unlike `availability`'s strict shift-id check.

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

`next_field_id`/`action` are mutually exclusive per option, and `next_field_id` must reference an existing field in the same form. The branching replay (both the frontend's client-side jump-graph walk and the backend's submission-time reachability check) matches a submitted answer against an option by `option_id`, not `value`. Multi-field loops (A→B→A) aren't currently guarded against — deferred until it's a real problem.

## Reserved `field_key`s

| `field_key` | Allowed `question_type`(s) | Write-through |
|---|---|---|
| `availability` | `single_select_radio` or `multi_select_checkbox` | `TournamentMembershipAvailability` (tournament-owned forms only); selected option_id(s) expand into their grouped `TournamentShift` ids before diffing |
| `lunch_{date}_{category}` — e.g. `lunch_20270213_protein` (`^lunch_\d{8}_[a-z0-9_]+$`), one per (date, category) pair | `single_select_radio` or `multi_select_checkbox` | `TournamentMembershipLunch` (tournament-owned forms only); selected option_id(s) resolve to their stored `value`/`label`, no catalog table — stores whatever option was selected, keyed by category string |
| `event_preference` | `ranked_choice`, `multi_select_checkbox`, or `single_select_dropdown` | none — generic `FormAnswer` (option `value` may be `list[int]` of real `TournamentEvent` ids, resolved on render; not yet strictly validated against real events) |
| any TD-typed slug | any type | none — generic `FormAnswer` |

Reserved keys are valid on both tournament- and chapter-owned forms — the key itself doesn't require tournament ownership. Only the write-through step is tournament-only; on a chapter-owned form these fields behave exactly like a normal custom question.

---

## `Form.status`

`Form.status` is `"draft"` | `"published"` | `"archived"`, set/transitioned via `PATCH /forms/{form_id}/`:
- **Only a `published` form accepts responses.** `POST /forms/{form_id}/responses/` rejects with `409` on a `draft` or `archived` form, regardless of the requester's access level.
- **A `published` form can't be reverted to `draft`.** `PATCH .../status: "draft"` on a currently-`published` form is rejected with `409` — archive it instead if it should stop accepting responses. This exists because `draft`-status editing is a hard-delete/direct-apply path (see Edit Lifecycle below); allowing published → draft would let a TD silently destroy already-answered fields/options through a path that was never meant to touch live data.
- Publishing (`draft` → `published`, or an explicit republish while already `published`) runs a whole-form validation pass (`validate_form_for_publish`): the form must have at least one active field, and every field's `config`/branching/`next_field_id` resolution must be valid in aggregate — not just individually — before the transition/republish is allowed.

## Edit Lifecycle

Once a form is `published`, someone may have already answered it, so editing its fields doesn't work the way it does on a `draft` form. There's no server-side draft/staging table — the client holds an in-progress edit locally and sends the complete target field list in one request, which the server treats as "go live now."

**`PUT /forms/{id}/fields/`** replaces the old per-field `POST`/`PATCH`/`DELETE` routes entirely. Body is the full ordered target list of fields:
- Entry with an existing field `id` → update.
- Entry with no `id` → create.
- A currently-live, non-archived field whose `id` is missing from the list → removal.

**`draft`-status forms:** applied directly — hard delete removed fields, update changed ones (including `question_type` changes, in place), insert new ones. No archiving, since nothing on a form that's never been published has ever been answerable.

**`published`-status forms:** the server diffs the submitted list against current live fields, then validates the whole proposed end-state (config shape, options, branching `next_field_id` resolution) before anything commits — a dangling branch reference, including one that would point at a field this same request removes, rejects the whole batch atomically. If valid:
- Label/description/config-only changes → update in place.
- `question_type` change → archive the old field, create a replacement at the same list position, inheriting the same `field_key` (an explicit exception to "archived keys stay reserved forever" — this is the same logical question continuing, not a new one).
- Missing from the submitted list → archive, not delete.
- No `id` → insert as new.
- Within an updated field, options are diffed by `option_id` the same way — one missing from the submitted config gets `is_archived: true` added rather than being dropped from storage.

**`FormResponsePendingUpdate`** (`response_id`, `field_key`, `reason`: `"field_replaced"` | `"option_archived"`, unique on `(response_id, field_key)`) is generated whenever a republish archives a field or option that a response had already answered — this is how a TD or respondent finds out an existing answer needs another look. Keyed by `field_key` (not a field id) so it always resolves to whichever field currently holds that key, regardless of further edits. `reason` only ever escalates `option_archived` → `field_replaced`, never the reverse. Cleared when the response next submits a fresh answer to whichever field currently holds that `field_key`.
