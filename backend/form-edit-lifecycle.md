# Form Edit Lifecycle

**Target-state specification.** Describes how editing a form that already has
responses should behave. Companion to `form-question-types-reference.md`,
which covers config/option shapes.

## Principles

1. **Edits mutate in place.** A field keeps its `id` across every edit —
   `question_type`, `field_key`, options, all of it. Archiving is for
   retirement, not for editing.
2. **Answers are self-describing.** A stored answer records the shape it was
   answered under, so reading history never depends on the field's current
   configuration.
3. **Stored answers are never rewritten.** No migration, no replay, no
   recompute. See Write-through.
4. **Intent is declared, not inferred.** A diff cannot distinguish "we ran out
   of shirts" from "this option was never valid." The TD says which.
5. **`field_key` is a name, not an identity.** It's a display and
   write-through label. Only `field_id` identifies a question.

## Identity

| Identifier | Mutable | Role |
|---|---|---|
| `FormField.id` | never | The question. What answers and pending updates reference. |
| `FormField.field_key` | freely | Display name + write-through semantics. Unique among **live** fields per tournament; an archived field's key is released. |
| Option `option_id` | never | The choice. What answers reference. |

Because identity lives on `field_id`, renaming a `field_key` requires no
bookkeeping — nothing else keys off it.

## Answer storage

`FormAnswer` stores `field_id`, the selected `option_id`(s), a
`{option_id, value, label}` snapshot taken at submit time, and the
`question_type` **and** `field_key` it was answered under.

Answer shape is a function of `(question_type, field_key)` — a preset key
stores entity ids where a standard key stores text. Recording both is what
makes every in-place change safe to read back: a pre-change answer is still
interpreted by the rules that were in force when it was given.

Two read paths, deliberately different:

- **Responses view** (form submissions) — render the snapshot verbatim. Shows
  what the respondent actually saw.
- **Member profile** (current truth) — resolve `option_id` against the field's
  *current* config and use today's `value`/`label`. Fall back to the snapshot
  only when the option no longer exists.

## When a pending update is raised

`FormResponsePendingUpdate` asks a previous responder to look at a question
again.

**Mandatory — always raised, TD cannot suppress:**

| Change | Who is flagged |
|---|---|
| `question_type` changes shape class (below) | everyone who answered |
| Option added or reopened | everyone who answered |
| Option invalidated | only those who selected it |
| Field becomes required | only those who left it blank |

An added option flags everyone because a previous responder may have settled
for a lesser choice when their real answer wasn't offered. Reopening a closed
option is identical in effect, so it's treated the same.

**Never raised:**

| Change |
|---|
| `question_type` changes within its shape class |
| Option `value` edited (TD-facing text only) |
| Option closed |
| Field retired |
| Field order, `display_style`, branching targets |

**TD's choice:**

| Change | Default | Why it's a judgment call |
|---|---|---|
| `field_key` moves between preset and standard | **on** | Nothing changed for the respondent — the labels can be identical, and their answer is still correct. But write-through is forward-only, so their data won't reach `MembershipAvailability` / `TournamentMembershipLunch` / track statuses unless they resubmit. The TD is deciding whether they need that data for people who already answered. |
| Question label | off | Rewording may or may not change what's being asked. |
| Question description | off | Same. |
| Option label (respondent-facing text) | off | Same. |

The preset toggle defaults **on** because silently leaving existing responders
out of write-through is the more surprising outcome. The confirmation modal
should say so, not just show a switch.

### Shape classes

A `question_type` change matters only when the stored answer shape changes.

| Class | Types | Stored shape |
|---|---|---|
| text | `short_text`, `long_text` | string |
| single-select | `single_select_radio`, `single_select_dropdown` | one snapshot |
| multi | `multi_select_checkbox` | list of snapshots |
| ranked | `ranked_choice` | `{rank: snapshot}` |
| bool | `acknowledgment` | boolean |

Within a class → presentational, no pending update. Across classes →
mandatory.

## Save-time confirmation

Shown only when the form is history-preserving, and only when the save
contains at least one change that could raise a pending update.

A modal lists every edited question with a per-question toggle:

- **Mandatory** changes appear with the toggle on and locked, so the TD sees
  the full blast radius before committing.
- **TD's choice** changes appear editable, at the default for that change
  type (see the table above — not all default off).
- Where a default carries a non-obvious consequence, the row states it. A
  preset key change that's toggled off should read as "existing responses
  won't be written through," not as a bare switch.
- Questions whose edits never raise a pending update aren't listed.

This is the last chance to reconsider before responders are asked to redo
work.

## Option lifecycle

Four verbs. The TD picks; the system never guesses.

| Verb | Meaning | Storage | Pending update |
|---|---|---|---|
| **Add** | new choice available | appended | everyone |
| **Close** | ran out; existing answers still valid | `is_archived: true` | nobody |
| **Reopen** | a closed option is available again | `is_archived: false` | everyone |
| **Invalidate** | never valid; existing answers are wrong | removed | only those who selected it |

All four keep the same `field_id` — the question didn't change, its choices
did. An invalidated option's past answers still render from their snapshot;
they're flagged as stale, not corrupted.

Closed options are never shown to respondents and never appear as editable
rows in the builder. They live in storage only.

## Field lifecycle

| Action | Effect | Answers | Pending update |
|---|---|---|---|
| **Edit** | mutate in place; `id` preserved | untouched | per the tiers above |
| **Retire** | `is_archived: true`; key released | kept as history | **open ones deleted** |
| **Restore** | `is_archived: false` | re-link automatically via `field_id` | none |
| **Invalidate** | `is_archived: true` | **purged**, with write-through cleanup | **open ones deleted** |

Retiring or invalidating a field **deletes its open pending updates.** A flag
on a field the respondent can no longer answer is unclearable by construction
— `PATCH` would reject the field, and the question isn't rendered. This is not
optional cleanup; skipping it strands respondents permanently.

**Restore** works because editing never changes `field_id`, so `FormAnswer`
rows still point at the field. On restore, re-validate: `next_field_id` may
point at something since retired, and the `field_key` may have been claimed by
a live field while it was gone.

**Invalidate** is the only destructive action. It's for a question that should
never have been asked — the answers are not history worth keeping. Requires
explicit confirmation.

Archived fields appear in the builder in a collapsed **Archived questions**
section, never inline — they must not participate in `order` or be selectable
as branching targets. Restoring appends to the end of `order`.

## Response routes

| Route | Access | Behavior |
|---|---|---|
| `POST /forms/{id}/responses/` | view | **Create only.** `409` if this user already has a response. Validates every required field; writes through every answer. |
| `PATCH /forms/{id}/responses/me/` | view | **Gated edit.** Body carries `{field_id, value}` for one or more fields. |
| `GET /forms/{id}/responses/` | manage | all responses |
| `GET /forms/{id}/responses/me/` | view | own response |

`PATCH` rejects with `403` any `field_id` that does not have an open pending
update for this response. That is the whole gate: a respondent can only touch
what the TD asked them to revisit, enforced server-side rather than by the UI.

- Only the patched fields' answers are replaced. Everything else is untouched.
- Required-field validation applies to the patched fields only — the rest
  already satisfied it at creation.
- Write-through runs for the patched fields only.
- Each patched field's pending update is cleared.

## Clearing a pending update

A pending update clears when its field is patched — explicitly, one at a time.
If a TD flags three questions and the respondent answers one, the other two
stay open.

`created_at` is retained for display and ordering ("flagged 3 days ago"), not
for clearing.

## The respondent's update flow

A submitted response is **not freely editable.** A respondent may only change
questions that carry a pending update — enforced by `PATCH`, not by the UI.

The form reopens with full context, but only the flagged questions are live:

- Every previously answered question renders prefilled.
- Questions with a pending update render blank, highlighted, and editable.
- Every other question renders read-only, showing its prior answer. It is
  **not** resubmitted — `PATCH` carries only the flagged fields.
- The respondent is never asked to retype answers that didn't change.

A respondent who needs to correct something that isn't flagged asks the TD,
who can raise a pending update for that question. There is no self-serve path,
because an unrestricted edit to an old response can overwrite newer state
elsewhere (see Write-through).

## Write-through

**Write-through is forward-only.** It runs at submission time and never
recomputes from stored answers. Replaying historical answers would apply them
out of submission order — an old form's "interested" would overwrite a newer
form's "confirmed."

This is why answers are never rewritten when a `field_key` moves between
preset and standard: the old answers keep their original semantics, and only
new submissions write through under the new key.

**Rows already written stay, by design.** Moving a question away from a preset
does not remove what it previously wrote to `MembershipAvailability` or track
statuses. Those tables are shared — multiple questions, across multiple forms,
contribute to the same rows, so no single field owns any of them and none can
be safely withdrawn. Lunch is the exception: keyed by (membership, category),
it has a single owner and can be deleted.

Cleanup on **Invalidate**:

| Target | Rule |
|---|---|
| `TournamentMembershipLunch` | keyed by (membership, category) — delete the field's rows |
| `MembershipAvailability` | **never deleted.** Rows are a union across every active `availability_*` field; per-field deletion is undefined. |
| Track statuses | **never deleted.** A track's state may have been set by a later form; removing this field's contribution can't be done without replay. |

A blanket "reset all availability" is a separate, explicit TD action, not a
side effect of editing one field. It should stay rare — re-collecting form
responses is expensive in practice.

## Storage

- `FormAnswer` records `field_id`, the selected `option_id`(s), the
  `{option_id, value, label}` snapshot, and the `question_type` / `field_key`
  the answer was given under.
- `FormResponsePendingUpdate` is keyed on `field_id`, with `created_at` for
  display and ordering.
- `field_key` is unique among **live** fields within a tournament. Archived
  fields do not reserve their keys, and may share a key with a live field.

## Track status ordering

Track status write-through is last-write-wins, and "last" is the order
write-through runs, not submission order. Left unconstrained, a respondent
editing an older form could demote a track that a newer form already set to
`confirmed`.

Three rules narrow this to near-zero:

1. **Forward-only write-through** — historical answers are never replayed.
2. **Locked responses** — a respondent can only edit questions the TD flagged,
   so no spontaneous edits to old forms.
3. **Patch-scoped write-through** — an edit carries only the flagged fields,
   so no other field's write-through re-fires.

**Remaining exposure:** a TD raises a pending update on a track question in an
*older* form, and the respondent's new answer overwrites a newer form's status.
This requires a deliberate TD action on that specific question, so it's
visible rather than silent — but it is not prevented.

Closing it fully needs write-through to record which response last set each
track status and reject an out-of-order write.

## Out of scope

A TD editing another user's response. Responses are locked to flagged fields
and there is no TD override.
