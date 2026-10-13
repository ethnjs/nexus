# Member seeding

`app/db/seed_members.py` fills a tournament with believable members: profiles, prior experience, and onboarding form responses. It doesn't assign tournament roles.

```bash
cd backend
uv run python -m app.db.seed_members --tournament 3 --create 50
```

It refuses to run unless `APP_ENV` is `development` or `preview`.

## How it works

**The script never writes track statuses, availability, lunch or event preferences directly.** It answers the tournament's onboarding forms and lets the real submission path produce those rows. Writing them directly produces states no respondent could reach, such as a member interested in test writing with no test-writing event preference, and those then look like bugs in whatever screen shows them.

For each member it walks each onboarding form from the first field, picks an answer, and recomputes reachability before choosing the next question, so branching and required rules are obeyed. The finished answers go through the same helpers `POST /forms/{id}/responses/` uses (`_store_answers`, `_write_through_reserved_fields`, `advance_onboarding_progress`).

As a result, editing the onboarding forms needs no seeder changes, and seeded rows carry the same provenance (`source_response_id`, `source_field_id`) as a real submission.

Nothing is hardcoded to a database. Tracks, shifts, events, universities and forms are looked up at runtime, so one command works against dev and preview. Profile dates are anchored to the tournament's own year rather than today, so graduation year, grade and birth date agree with each other.

## Flags

| Flag | Default | What it does |
| --- | --- | --- |
| `-t`, `--tournament ID` | required | Tournament to seed |
| `--email-prefix PREFIX` | `test` | Seed accounts whose email starts with this |
| `--email-domain DOMAIN` | `nexus.dev` | Domain for accounts this run creates |
| `--limit N` | all | Only the first N matching accounts |
| `-c`, `--create N` | off | Seed N members in total, creating whichever of `PREFIX1`..`PREFIXN` don't exist yet |
| `--password PW` | `test1234` | Password for accounts this run creates |
| `--rng-seed N` | `0` | Random seed. The same value gives the same fake people. It's not a count. |
| `--stop-every N` | `5` | Every Nth member stops after the first form (`0` turns it off) |
| `--unstarted-every N` | `11` | Every Nth member submits nothing (`0` turns it off) |
| `--dry-run` | off | Roll back instead of committing |
| `--force` | off | Run outside `development`/`preview` |

These are on by default, and each has a `--no-` form (`--no-onboarding`):

| Flag | What it covers |
| --- | --- |
| `--onboarding` | Replays onboarding form submissions |
| `--profiles` | Overwrites user profile fields |
| `--experience` | Adds prior competition and volunteer history |
| `--enroll` | Creates memberships for matching accounts that lack one |
| `--age-consent` | Consents to age disclosure when the tournament collects it |

**`--create N` is a target, not an amount to add.** With `test1`..`test15` already present, `--create 50` creates `test16`..`test50`. Running it twice still leaves fifty. Existing accounts are never renamed or given a new password, but they are re-seeded like everyone else. New accounts get a random name and a verified email, so they can log in immediately.

Without `--create`, only existing accounts are seeded.

## Recipes

```bash
# Preview without changing anything
uv run python -m app.db.seed_members -t 3 --dry-run

# Seed the dev accounts user1..user15@nexus.dev
uv run python -m app.db.seed_members -t 3 --email-prefix user

# Profiles and experience only, leaving onboarding responses alone
uv run python -m app.db.seed_members -t 3 --no-onboarding

# Everyone fully onboarded
uv run python -m app.db.seed_members -t 3 --stop-every 0 --unstarted-every 0

# A different but equally reproducible population
uv run python -m app.db.seed_members -t 3 --rng-seed 7
```

## What it resets

Re-running is safe because the script first clears what it's about to write, for the seeded accounts on this tournament:

- their onboarding `form_responses` and `form_answers`,
- their track status, availability, event preference and lunch rows,
- and `onboarded_at`.

The reset is required. Track-status write-through only upserts and refuses some transitions (see `track-status-rules.md`), and a second response to the same form is a 409, so a second run would otherwise blend into the first.

It never touches tournament configuration, forms, events, or accounts outside `--email-prefix`.
