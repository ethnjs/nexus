# Member seeding

`app/db/seed_members.py` fills a tournament with believable members: profiles,
prior experience, and onboarding form responses.

Tournament roles are deliberately not seeded — assign those yourself.

```bash
cd backend
python -m app.db.seed_members --tournament 3
```

It refuses to run unless `APP_ENV` is `development` or `preview`. `--force`
overrides that; there is no reason to use it.

---

## The one thing that matters

**The script does not write track statuses, availability, or event
preferences.** It answers the tournament's onboarding forms and lets the real
submission path produce those rows.

Writing them directly is what produces states no respondent could have reached:
a member `interested` in Test Writing with no test-writing event preference,
availability on a day they declined, a Writer's Class interest without the
test-writing interest that gates it. Those states then look like bugs in
whatever screen renders them.

So instead, for each member the script:

1. Walks the form from the lowest-order field.
2. Picks an answer for the current question.
3. Recomputes reachability with that answer applied, which decides what comes
   next — a `submit_form` option ends the walk, a `next_field_id` jumps, and
   everything else falls through in order.
4. Repeats until nothing reachable is unanswered.
5. Hands the finished answer set to `_store_answers`,
   `_write_through_reserved_fields` and `advance_onboarding_progress` — the
   same helpers `POST /forms/{id}/responses/` calls.

Step 3 is the whole trick. Recomputing after *every* pick is what stops a "No"
answer from also carrying answers to the questions it skips, and what
guarantees a required follow-up is present whenever its gate is open.

The payoff: **edit the onboarding forms and the seeder follows the new rules
with no changes.** Add a branch, make a question required, regroup an
availability option — the next run obeys it, because it is replaying
submissions rather than imitating their results.

It also means the seeded data carries real provenance: every
`tournament_membership_track_statuses` row points back at the
`form_responses` row and `form_fields` id that set it, exactly as a live
submission would.

---

## Flags

| Flag | Default | What it does |
| --- | --- | --- |
| `-t`, `--tournament ID` | required | Tournament to seed. |
| `--email-prefix PREFIX` | `test` | Seeds accounts whose email starts with this. |
| `--limit N` | all | Only the first N matching accounts. |
| `--seed N` | `0` | RNG seed. Same value, same data. |
| `--dry-run` | off | Roll back instead of committing. |
| `--force` | off | Allow running outside development/preview. |

### What to seed

Each takes a `--no-` counterpart (`--no-onboarding`, `--no-profiles`, …).

| Flag | Default | What it covers |
| --- | --- | --- |
| `--onboarding` | on | Replays the onboarding form submissions. |
| `--profiles` | on | Overwrites user profile fields. |
| `--experience` | on | Prior competition/volunteer history. |
| `--enroll` | on | Creates memberships for matching accounts that lack one. |

### Onboarding completion mix

| Flag | Default | What it does |
| --- | --- | --- |
| `--stop-every N` | `5` | Every Nth member stops after the first form. |
| `--unstarted-every N` | `11` | Every Nth member submits nothing. |

A fixed cadence, not a dice roll — partway-through onboarding states are
guaranteed to exist rather than depending on how the seed happens to land.
`0` disables either one.

---

## Recipes

```bash
# See what it would do, change nothing.
python -m app.db.seed_members -t 3 --dry-run

# Local dev, where the accounts are member*@nexus.dev.
python -m app.db.seed_members -t 3 --email-prefix member

# Profiles and experience only, leaving onboarding responses untouched.
python -m app.db.seed_members -t 3 --no-onboarding

# Everyone fully onboarded, no partial states.
python -m app.db.seed_members -t 3 --stop-every 0 --unstarted-every 0

# A different population, same shape.
python -m app.db.seed_members -t 3 --seed 7

# Just a handful, for a quick screen check.
python -m app.db.seed_members -t 3 --limit 5
```

---

## What it resets

Re-running is safe, but not because the writes are idempotent — the script
clears its own targets first:

- `form_answers` and `form_responses` for the seeded accounts on this
  tournament's onboarding forms
- `tournament_membership_track_statuses`, `..._availability`,
  `..._event_preferences`, `..._lunch` for those memberships
- `onboarded_at` back to `NULL`

That reset is required, not tidiness. `sync_track_statuses` only ever upserts
(it cannot delete, and refuses `confirmed → interested` outright), and a second
`POST` for the same `(form, user)` is a 409. Without the reset, a second run
would blend into the first.

It does **not** touch memberships it did not create, tournament configuration,
forms, events, or any account outside `--email-prefix`.

---

## Portability

Nothing is hardcoded to a database. Tracks, shifts, tournament events,
universities, the catalog events and the onboarding forms are all looked up at
runtime by ownership, so the same invocation works against dev and preview
where the ids differ.

Profile years are anchored to the tournament's own year (via
`Tournament.last_day`, itself derived from the primary tracks) rather than to
today — so graduation year, year level and date of birth agree with each other
and with the tournament being seeded.

---

## Where this lives

- `app/db/seed_members.py` — the script
- `app/core/form/branching.py` — the reachability walk it replays
- `app/core/form/write_through.py` — how answers become structural rows
- `form-question-types-reference.md` — reserved field keys and question types
- `track-status-rules.md` — why the reset above is necessary
