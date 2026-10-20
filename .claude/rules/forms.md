---
paths:
  - "backend/app/core/form/**"
  - "backend/app/api/routes/forms.py"
  - "backend/app/api/routes/tournament/onboarding.py"
  - "backend/app/schemas/form.py"
  - "backend/tests/core/test_form_*.py"
  - "backend/tests/api/test_forms.py"
  - "backend/tests/api/tournament/test_onboarding.py"
  - "frontend/lib/forms/**"
  - "frontend/components/forms/**"
  - "frontend/components/tournament/forms/**"
  - "frontend/app/forms/**"
  - "frontend/app/dashboard/tournaments/**/forms/**"
---

# Forms

Before changing form behavior, read the relevant design note in `backend/docs/`:

- `form-question-types-reference.md`: field, config, option and answer shapes, reserved keys, form status.
- `form-edit-lifecycle.md`: archive vs. invalidate, response editing, write-through.
- `track-status-rules.md`: the two track-status writers and why they differ.

Invariants that are easy to break:

- **`FormField.id` and `option_id` are identities and never change.** Answers and branching reference them. `field_key` is a renameable name that must be unique among live fields across a tournament's forms.
- **Edits mutate fields in place**, including `question_type` changes. Archiving retires a field; only `DELETE /forms/{id}/fields/{field_id}/` (invalidate) destroys a field and its answers.
- **Write-through runs forward only**, at submit and `PATCH`. Stored answers are never replayed or rewritten. The one exception is a field that becomes a lunch question, which backfills once.
- **Reserved keys** (`availability_{track_id}[_{suffix}]`, `event_preference_{track_id}`, `lunch_{track_id}_{category}`, `track_status_{suffix}`) reuse ordinary question types. The number is a track id.
- **Availability is scoped by track.** Every availability question feeds one shared pool per member, and a submission only changes shifts on the tracks it asked about.
- **Write-through never moves a track from `confirmed` back to `interested`.** That rule keeps statuses ordered when an older form's answer is edited, so don't relax it to allow walking a confirm back.
- An option's `value` changes shape by `field_key`. Read it through `option_shift_ids` / `option_track_assignments`, not `isinstance` checks.
- Config and option schemas use `extra="forbid"`, so new keys need schema changes.
