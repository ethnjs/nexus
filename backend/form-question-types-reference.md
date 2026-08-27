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

**Line between `question_type` and `field_key`:** `question_type` is purely structural — how the question is rendered and answered. `field_key` is semantic — when it's a reserved key (`availability_{date}`, `event_preference_{suffix}`, `lunch_{custom}`, `track_status_{suffix}`), it changes how a *structurally normal* field's options/answers get parsed and, for tournament forms, written through to a structural table. Reserved keys don't get their own `question_type` — they reuse the existing structural types and layer extra validation on top. When a TD picks a reserved-key preset/template, `field_key` should be locked to the reserved value rather than freely typed — otherwise a stray typo (`availibility`) silently breaks write-through with no error. Flagging this as the intended behavior, not yet confirmed.

A tournament may have **multiple** fields under the same reserved prefix — `availability_20260315`, `availability_20260316` for two dates, `event_preference_morning`, `event_preference_afternoon` for two independently-ranked axes. `availability_*` fields are the one case where multiple questions share a single pool of storage (see below) — every other reserved key, including `event_preference_*`, keeps each suffix's answers separate simply because each field has its own `field_id`/`FormAnswer` row; there's no merging step needed for that.

**Options-storage rule:** wherever a type has an `options` array, each option is `{ "option_id": ..., "value": ..., "label": ..., "is_archived": false }`:
- `option_id` — system-generated, opaque, required, and the **sole stable identifier**: what a submitted answer actually references, what branching matches against, and what the edit lifecycle diffs/archives by (see "Reserved `field_key`s" and `form-edit-lifecycle.md`). Never client-authored; a create/update request may omit it (new option) or echo back one from a prior `GET` (existing option, kept stable).
- `value` — normally TD-facing display text (typically a shortened version of `label`). For an entity-backed reserved `field_key` (`availability` grouping `TournamentShift`s, `event_preference` grouping `TournamentEvent`s), it's instead `list[int]` — the real ids of the underlying entities this option groups together — and the client is responsible for interpreting which shape to expect based on `field_key`. A bare `list[int]` for `event_preference` is resolved on render (see below); a legacy plain-string `value` there passes through unresolved.
- `label` — responder-facing display text.
- `is_archived` — set by the server during a published-form republish (see `form-edit-lifecycle.md`); an archived option is dropped from what a new respondent sees/can select, but stays in storage so a past answer referencing its `option_id` still resolves.

Options are stored raw and literal — a resolved snapshot at creation/edit time, not a dynamic source reference. Editors may offer an "auto-load from tournament" convenience (events, shifts) that populates `value`'s entity-id list once; after that it's just a normal static list like any other question's options, no live server-side lookup involved.

**Answer-value snapshotting:** for any option-bearing type except an `availability_*`-keyed field (still on its own raw-shift-id submission path, see below), `FormAnswer.value` doesn't store a bare `option_id` — it stores a `{ "option_id": ..., "value": ..., "label": ... }` snapshot captured at submission time (a list of snapshots for `multi_select_checkbox`, a rank→snapshot dict for `ranked_choice`). This means a later edit to an option's `value`/`label` (TD-editable text, unlike `option_id`) never retroactively changes how a past answer displays — see `FormResponsePendingUpdate` below for how a TD/respondent actually finds out something changed.

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
| `availability_{date}` — e.g. `availability_20260315` (`^availability_\d{8}$`), one per date; a bare `availability` (no date) is **not** a valid reserved key | `single_select_radio` or `multi_select_checkbox` | `TournamentMembershipAvailability` (tournament-owned forms only); selected option_id(s) across **every** active `availability_*` field on the response are expanded into their grouped `TournamentShift` ids, unioned, and diffed as one set — every date's question feeds the same centralized "shifts this member is available for" pool, not a per-date table |
| `lunch_{date}_{category}` — e.g. `lunch_20270213_protein` (`^lunch_\d{8}_[a-z0-9_]+$`), one per (date, category) pair | `single_select_radio` or `multi_select_checkbox` | `TournamentMembershipLunch` (tournament-owned forms only); selected option_id(s) resolve to their stored `value`/`label`, no catalog table — stores whatever option was selected, keyed by category string |
| `event_preference_{suffix}` — e.g. `event_preference_morning` (`^event_preference_[a-z0-9_]+$`), one per independently-ranked axis; a bare `event_preference` (no suffix) is **not** a valid reserved key | `ranked_choice`, `multi_select_checkbox`, or `single_select_dropdown` | none — generic `FormAnswer`, same as any custom question (option `value` may be `list[int]` of real `TournamentEvent` ids, resolved on render; not yet strictly validated against real events). Unlike `availability`, different suffixes are **not** merged into one pool — each suffix is read as its own axis by querying `FormAnswer` directly wherever event preferences are needed downstream, rather than being synced into a dedicated structural table. `TournamentMembership.event_preference` is an unrelated, already-deprecated manual-entry JSON column (along with `role_preference`, `availability`, `lunch_order`, `extra_data` on that model) — not read or written by this write-through. |
| `track_status_{suffix}` — e.g. `track_status_volunteer_interest` (`^track_status_[a-z0-9_]+$`), one per independently named status question | `single_select_radio` or `multi_select_checkbox`, and `required` **must** be `true` | pending membership-track status write-through; each option's `value` is the list of track assignments it applies (shape below). An `availability_*` field may carry assignments too, but only with `track_status_enabled: true`. Checkbox options may repeat a track only when they assign it the same status. |
| any TD-typed slug | any type | none — generic `FormAnswer` |

Reserved keys are currently valid only on tournament-owned forms. `track_status_*` also requires tracks from that tournament's catalog.

### Preset `config` shapes

A preset never introduces its own `question_type` — it reuses a structural one
and changes what each option's `value` holds. There are **five** distinct
shapes, because `availability_*` has two depending on the track opt-in. All
option schemas are `extra="forbid"` (`app/schemas/form.py`): a key that isn't
in the shape below is rejected outright, not ignored.

**1. `availability_{date}` — plain.** `value` is the `TournamentShift` ids this
option groups.

```json
{ "required": true, "display_style": "list", "options": [
  { "option_id": "a1b2c3d4e5", "label": "All Day", "value": [3, 2, 5] }
] }
```

**2. `availability_{date}` — with track statuses.** Set by the builder's "Also
update track status" toggle. `config.track_status_enabled: true` is what
*permits* assignments here; the flag is availability-only and rejected on any
other reserved key. `value` becomes an object — `shift_ids` is required and
non-empty.

```json
{ "required": true, "track_status_enabled": true, "options": [
  { "option_id": "a1b2c3d4e5", "label": "All Day", "value": {
    "shift_ids": [3, 2, 5],
    "track_statuses": [{ "id": 7, "status": "confirmed" }]
  } }
] }
```

**3. `event_preference_{suffix}`.** `value` is the `TournamentEvent` ids
grouped under one label. Not yet strictly validated against real events.

```json
{ "required": true, "ranks": 3, "allow_duplicates": false, "options": [
  { "option_id": "a1b2c3d4e5", "label": "Life Science", "value": [5, 9] }
] }
```

**4. `lunch_{date}_{category}`.** Looks like a preset but its options are
ordinary TD-typed text — `value` is a plain string, same as any custom
question. The reserved key only drives write-through.

```json
{ "required": true, "display_style": "list", "options": [
  { "option_id": "a1b2c3d4e5", "label": "Vegetarian", "value": "vegetarian" }
] }
```

**5. `track_status_{suffix}`.** `value` **is** the assignment list — there is
no separate `track_statuses` key on the option. `required` must be `true`.

```json
{ "required": true, "display_style": "list", "options": [
  { "option_id": "a1b2c3d4e5", "label": "Yes", "value": [
    { "id": 7, "status": "interested" }
  ] },
  { "option_id": "f6e5d4c3b2", "label": "No", "value": [] }
] }
```

**Assignment shape**, shared by 2 and 5: `{ "id": <TournamentTrack id>,
"status": "interested" | "confirmed" | "declined" }`. Both keys are required
— `id` is the track's catalog id (**not** `track_id`), and `status` has no
default. Track ids must belong to the field's own tournament; archived tracks
stay valid so historical fields still resolve. On `multi_select_checkbox`, two
options may only name the same track if they assign it the same status.

Duplicate track ids *within a single option* are rejected on shape 2 only —
`_unique_track_statuses` is wired into `AvailabilityTrackStatusValue` but not
into a bare `list[TrackStatusAssignment]`, so shape 5 currently accepts
`[{"id": 7, "status": "interested"}, {"id": 7, "status": "declined"}]`.
Asymmetry, not intent.

**Why `value` and not a dedicated key:** the option schemas union
`str | list[int] | list[TrackStatusAssignment] | AvailabilityTrackStatusValue`
on `value` rather than adding per-preset fields, so switching presets rewrites
one field instead of migrating between key sets. The cost is that `value`'s
shape is only interpretable alongside `field_key` — code that reads options
must discriminate on the *element*, not just `isinstance(value, list)`, or it
will read grouped entity ids as track assignments.

---

## `Form.status`

`Form.status` is `"draft"` | `"published"` | `"archived"`, set/transitioned via `PATCH /forms/{form_id}/`:
- **Only a `published` form accepts responses.** `POST /forms/{form_id}/responses/` rejects with `409` on a `draft` or `archived` form, regardless of the requester's access level.
- **A `published` form can't be reverted to `draft`.** `PATCH .../status: "draft"` on a currently-`published` form is rejected with `409` — archive it instead if it should stop accepting responses. This exists because `draft`-status editing is a hard-delete/direct-apply path (see `form-edit-lifecycle.md`); allowing published → draft would let a TD silently destroy already-answered fields/options through a path that was never meant to touch live data.
- Publishing (`draft` → `published`, or an explicit republish while already `published`) runs a whole-form validation pass (`validate_form_for_publish`): the form must have at least one active field, and every field's `config`/branching/`next_field_id` resolution must be valid in aggregate — not just individually — before the transition/republish is allowed.
