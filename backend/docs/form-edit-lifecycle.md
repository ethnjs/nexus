# Form edit lifecycle

How editing a form that already has responses behaves: what gets flagged for respondents, how fields and options are retired, and how answers reach the tournament's structural tables. Field and option shapes are in `form-question-types-reference.md`; track status rules are in `track-status-rules.md`.

## Principles

1. **Edits mutate in place.** A field keeps its `id` through every edit, including `question_type` and `field_key` changes. Archiving takes a question out of use; it is never a step in changing one.
2. **Answers describe themselves.** Each `FormAnswer` records the `question_type` and `field_key` it was given under, plus option snapshots, so history reads correctly whatever the field's current config.
3. **Stored answers are never rewritten.** There's no migration, replay or recompute of old answers.
4. **The TD declares intent.** A diff can't tell "we ran out of shirts" from "this option was never valid", so the TD picks the verb.

## Draft vs. history-preserving

A form is **history-preserving** once it's published or has any response (`_is_history_preserving`). Until then, the builder's save (`PUT /forms/{id}/fields/`) applies edits destructively: removed fields and options are deleted outright. Everything below applies to history-preserving forms.

The save sends the complete target field list, and the whole batch is validated together and committed or rolled back as one.

## Pending updates

A pending update asks a previous respondent to look at a question again. There's one `FormResponsePendingUpdate` row per (response, field), with the set of `reasons` that opened it. Reasons from one save are unioned.

**Mandatory**, always raised:

| Change | `reason` | Who is flagged |
|---|---|---|
| `question_type` moves to another shape class | `question_type_changed` | everyone who answered |
| Option added or unarchived | `option_added` | everyone who answered |
| Option invalidated | `option_invalidated` | those who picked it |
| Option regrouped on an entity-backed preset | `option_regrouped` | everyone who answered |
| Field becomes required | `now_required` | those who left it blank |

An added option flags everyone because a respondent may have settled for a lesser choice. Regrouping means an option's `value` now covers different shifts or events while its id and label stay the same ("Morning" no longer includes the 7am shift), so a stored answer commits the respondent to something they never picked.

**TD's choice**, per field at save time (`notify_responders`):

| Change | `reason` | Default |
|---|---|---|
| `field_key` moves between a preset and a plain key | `key_changed` | on |
| Question label, description or option label changes | `text_changed` | off |

`key_changed` defaults on because skipping it is invisible: write-through only runs on submit, so existing respondents never reach the structural tables unless they resubmit. The save-time confirmation modal (`POST /forms/{id}/fields/classify/`) lists every flagged question, shows mandatory reasons locked on, and lets the TD toggle the rest.

**Never raised:** a `question_type` change within its shape class, an option `value` edit, archiving an option or field, and changes to order, `display_style` or branching targets.

### Shape classes

| Class | Types | Stored answer |
|---|---|---|
| text | `short_text`, `long_text` | string |
| single select | `single_select_radio`, `single_select_dropdown` | one snapshot |
| multi | `multi_select_checkbox` | list of snapshots |
| ranked | `ranked_choice` | `{rank: snapshot}` |
| bool | `acknowledgment` | boolean |

## Option lifecycle

| Verb | How the save expresses it | Pending update |
|---|---|---|
| **Add** | new option without an `option_id` | everyone |
| **Archive** (ran out; answers stay valid) | option sent back with `is_archived: true` | nobody |
| **Unarchive** | option sent back with `is_archived: false` | everyone |
| **Invalidate** (never valid; answers are wrong) | option left out of the payload | those who picked it |

The field keeps its id in every case. An invalidated option's past answers still render from their snapshots. Archived options are never shown to respondents and don't appear as editable rows in the builder.

## Field lifecycle

| Action | How | Answers | Pending updates |
|---|---|---|---|
| **Edit** | field sent with its `id` | untouched | per the tables above |
| **Archive** | field left out of the payload | kept as history; key released | open ones deleted |
| **Unarchive** | archived field's `id` sent again | reattach through `field_id` | none |
| **Invalidate** | `DELETE /forms/{id}/fields/{field_id}/` | deleted, with write-through cleanup | deleted with the field |

Archiving deletes open pending updates because a flag on a question the respondent can no longer answer could never clear. Unarchiving rechecks that the key hasn't been claimed meanwhile and that branching still resolves.

Invalidate is the only destructive action and can't be undone. It has its own endpoint so a client bug in the bulk save can't reach it, and it returns 409 if removing the field would leave the form invalid, for example while a live option still branches to it.

Archived fields appear in a collapsed **Archived questions** section of the builder. They don't take part in `order` or branching, and unarchiving appends to the end.

## Responses

| Route | Access | Behavior |
|---|---|---|
| `POST /forms/{id}/responses/` | view | Create only; 409 if the user already responded. Validates required fields and writes through every answer. |
| `PATCH /forms/{id}/responses/me/` | view | Edits the given fields. |
| `GET /forms/{id}/responses/me/` | view | Own response |
| `GET /forms/{id}/responses/` | manage | All responses, with respondent names and emails |
| `DELETE /forms/{id}/responses/{response_id}/` | manage | Deletes one response; write-through rows stay. 409 on an archived form. |

A submitted response is locked. `PATCH` returns 403 for any field without an open pending update on this response, so respondents can change only what the TD asked them to revisit. To fix something else, they ask the TD to flag it. There's no TD override for editing someone else's response.

With `allow_response_edits` on, every live question is open and the client sends only the answers that changed. Required-field validation then runs over the merged response, because a changed branching answer can make an unanswered required question reachable.

On `PATCH`:

- only the patched answers are replaced,
- each patched field's pending update clears (individually; unpatched flags stay open),
- and write-through runs again, scoped as described below.

The respondent's update view shows prior answers read-only and opens only the flagged questions for editing. A pending update's `created_at` is for display ("flagged 3 days ago") only.

## Write-through

Answers to reserved-key questions on tournament forms are copied into structural tables (`_write_through_reserved_fields`). **Write-through runs forward only**, at submission, and is never replayed from stored answers. A replay would apply answers out of order, so an old form's "interested" could overwrite a newer form's "confirmed". For the same reason, moving a field between a preset and a plain key doesn't rewrite old answers; only new submissions write through under the new key.

The one exception is a field that becomes a lunch question: its existing answers are replayed into `TournamentMembershipLunch` once (`_backfill_lunch_write_through`), since lunch rows have a single owning field. The same replay would be unsafe for the shared tables.

### Availability is scoped by track

Every `availability_*` question on every form feeds one `TournamentMembershipAvailability` pool per member. A submission may add the shifts its selected options cover and remove shifts only on the tracks its availability questions ask about. Shifts on other tracks, possibly collected by another form, are left alone.

The boundary is every shift on the track, not just the shifts the options currently list. If a TD regroups an option so it no longer includes a shift, that shift still belongs to the track, so a respondent who drops it loses it instead of keeping it forever.

All availability questions in a submission are unioned (selections and tracks) before a single write, so one question's removals can't undo another's additions. Availability is recomputed from the whole response on `PATCH`, since the diff is idempotent.

### Track statuses are scoped by patched field

Track statuses only ever upsert, guarded by the transition rule in `track-status-rules.md`. On `PATCH`, only the patched fields write track statuses; replaying an untouched field would re-assert a status the respondent didn't touch. Provenance (`source_response_id`, `source_field_id`) is recorded for debugging and isn't used for ordering.

### Cleanup on invalidate

| Table | Rule |
|---|---|
| `TournamentMembershipLunch` | Deleted for the field. Keyed by (membership, track, category), so the field is the only writer. |
| `TournamentMembershipEventPreference` | Deleted for the field. One question per track, so the field is the only writer. |
| `TournamentMembershipAvailability` | **Kept.** Other questions may cover the same track, and this field's share can't be separated out. |
| `TournamentMembershipTrackStatus` | **Kept.** A later form may have set the status; removing this field's contribution would need a replay. |

Editing a field never resets availability wholesale. If that's ever needed, it should be its own explicit TD action.

## `FormResponsePendingUpdate`

| Column | Notes |
|---|---|
| `response_id` | the flagged response |
| `field_id` | the field to answer to clear it; never `field_key`, which the TD can rename |
| `reasons` | set of `reason` values |
| `created_at` | display and ordering |

Unique on `(response_id, field_id)`. A row clears when the field is patched and is deleted when the field is archived or invalidated.
