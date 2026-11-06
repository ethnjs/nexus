# Form edit lifecycle

How editing a form that already has responses behaves: how fields and options are retired, how respondents edit their responses, and how answers reach the tournament's structural tables. Field and option shapes are in `form-question-types-reference.md`; track status rules are in `track-status-rules.md`.

## Principles

1. **Edits mutate in place.** A field keeps its `id` through every edit, including `question_type` and `field_key` changes. Archiving takes a question out of use; it is never a step in changing one.
2. **Answers describe themselves.** Each `FormAnswer` records the `question_type` and `field_key` it was given under, plus option snapshots, so history reads correctly whatever the field's current config.
3. **Stored answers are never rewritten.** There's no migration, replay or recompute of old answers.
4. **The TD declares intent.** A diff can't tell "we ran out of shirts" from "this option was never valid", so the TD picks the verb.
5. **Nexus doesn't follow up with respondents.** Saving a form that has responses warns the TD that submitted answers stay as they were. Asking anyone to answer again is up to the TD.

## Draft vs. history-preserving

A form is **history-preserving** once it's published or has any response (`_is_history_preserving`). Until then, the builder's save (`PUT /forms/{id}/fields/`) applies edits destructively: removed fields and options are deleted outright. Everything below applies to history-preserving forms.

The save sends the complete target field list, and the whole batch is validated together and committed or rolled back as one.

## Option lifecycle

| Verb | How the save expresses it |
|---|---|
| **Add** | new option without an `option_id` |
| **Archive** (ran out; answers stay valid) | option sent back with `is_archived: true` |
| **Unarchive** | option sent back with `is_archived: false` |
| **Invalidate** (never valid) | option left out of the payload |

The field keeps its id in every case. An invalidated option's past answers still render from their snapshots. Archived options are never shown to respondents and don't appear as editable rows in the builder.

## Field lifecycle

| Action | How | Answers |
|---|---|---|
| **Edit** | field sent with its `id` | untouched |
| **Archive** | field left out of the payload | kept as history; key released |
| **Unarchive** | archived field's `id` sent again | reattach through `field_id` |
| **Invalidate** | `DELETE /forms/{id}/fields/{field_id}/` | deleted; write-through rows stay |

Unarchiving rechecks that the key hasn't been claimed meanwhile and that branching still resolves.

Invalidate is the only destructive action and can't be undone. It has its own endpoint so a client bug in the bulk save can't reach it, and it returns 409 if removing the field would leave the form invalid, for example while a live option still branches to it.

Archived fields appear in a collapsed **Archived questions** section of the builder and take no part in branching. They keep a slot in `order`: each save renumbers them with the live fields, right after the field each one followed, so `GET /forms/{id}/` can return them in place and a past response renders in its original order. Unarchiving in the builder puts the question back in that slot.

## Responses

| Route | Access | Behavior |
|---|---|---|
| `POST /forms/{id}/responses/` | view | Create only; 409 if the user already responded. Validates required fields and writes through every answer. |
| `PATCH /forms/{id}/responses/me/` | view | Edits the given fields. 403 unless the form has `allow_response_edits` on. |
| `GET /forms/{id}/responses/me/` | view | Own response |
| `GET /forms/{id}/responses/` | manage | All responses, with respondent names and emails |
| `DELETE /forms/{id}/responses/{response_id}/` | manage | Deletes one response; write-through rows stay. 409 on an archived form. |

A submitted response is locked unless the form has `allow_response_edits` on. Then every live question is open, and the client sends only the answers that changed. Required-field validation runs over the merged response, because a changed branching answer can make an unanswered required question reachable. There's no TD override for editing someone else's response.

On `PATCH`, only the patched answers are replaced, and write-through runs again, scoped as described below.

## Write-through

Answers to reserved-key questions on tournament forms are copied into structural tables (`_write_through_reserved_fields`). **Write-through runs forward only**, at submission, and is never replayed from stored answers. A replay would apply answers out of order, so an old form's "interested" could overwrite a newer form's "confirmed". For the same reason, moving a field between a preset and a plain key doesn't rewrite old answers; only new submissions write through under the new key.

That includes lunch. A plain question renamed to a lunch key fills `TournamentMembershipLunch` only as members submit, and its earlier answers drop out of custom responses, which exclude reserved keys. They stay stored and show on the form's own responses.

## Shared field keys

A key is unique among one form's live fields, but different forms may reuse it, with any question type. Where forms share a key, a member's latest answer is the one the tournament shows:

- Custom responses keep one answer per key per member, picked by `FormAnswer.answered_at`. Every stored answer stays; each form's responses page still shows what was given there.
- Settings that pick a custom answer name its key, not a field id: panel hiding and custom sections (`field_key:{key}`), roster and export columns (`field_key:{key}`), and the assignment card (`card_custom:{key}`). A field id would match only members whose latest answer came from that field.
- Reserved keys get the same result from write-through order: each submission replaces the rows its key owns (event preferences and lunch per track and category, availability per track), so the latest submission wins. Track statuses keep their own transition rule.

### Availability is scoped by track

Every `availability_*` question on every form feeds one `TournamentMembershipAvailability` pool per member. A submission may add the shifts its selected options cover and remove shifts only on the tracks its availability questions ask about. Shifts on other tracks, possibly collected by another form, are left alone.

The boundary is every shift on the track, not just the shifts the options currently list. If a TD regroups an option so it no longer includes a shift, that shift still belongs to the track, so a respondent who drops it loses it instead of keeping it forever.

All availability questions in a submission are unioned (selections and tracks) before a single write, so one question's removals can't undo another's additions. Availability is recomputed from the whole response on `PATCH`, since the diff is idempotent.

### Track statuses are scoped by patched field

Track statuses only ever upsert, guarded by the transition rule in `track-status-rules.md`. On `PATCH`, only the patched fields write track statuses; replaying an untouched field would re-assert a status the respondent didn't touch. Provenance (`source_response_id`, `source_field_id`) is recorded for debugging and isn't used for ordering.

### Invalidate keeps write-through rows

Deleting a field deletes its answers but leaves every row they wrote through, like deleting a response does. The rows are the membership's current data and may have been edited since; a TD who wants them gone changes them directly.

Editing a field never resets availability wholesale. If that's ever needed, it should be its own explicit TD action.
