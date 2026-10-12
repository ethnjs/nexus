# Anonymizing a prod copy

`app/db/anonymize_users.py` scrubs contact details and passwords from a
database restored from prod, so a test environment can run on real tournament
data without being able to email, text, or log in as real people.

```bash
cd backend
DATABASE_URL="<test DB public URL>" APP_ENV=preview \
  uv run python -m app.db.anonymize_users --keep <your-email>
```

It refuses to run unless `APP_ENV` is `development` or `preview`. `--force`
overrides that; there is no reason to use it.

---

## What it changes

| Column | Becomes |
| --- | --- |
| `users.email` | `user<id>@nexus.dev` |
| `users.phone` | `555-<id, zero-padded to 7>` — blank phones stay blank |
| `users.hashed_password` | the hash of `--password` (default `test1234`) |
| `sessions`, `verification_tokens` | truncated |

Names, profiles, form responses, and every id stay as they are.

**Ids are never touched, on purpose.** Track, shift and event ids are baked into
form field keys (`availability_7`, `lunch_7_veg`), field configs, answer values,
`display_config`, export preset columns and form prerequisites. Copying the
whole database and scrubbing in place keeps all of those valid; remapping ids
would mean rewriting them inside JSON, and a missed one fails silently.

**Why `nexus.dev`.** It matches the dev seed accounts, and it's unregistered,
so a reset or invite email fired from the copy bounces. Not `.test`: Pydantic's
`EmailStr` rejects special-use TLDs, so every response containing a user email
would fail validation and 500.

**Why truncate sessions and tokens.** Prod sessions mean nothing on the copy,
and an unused password-reset token would let someone set a password on it.

---

## Flags

| Flag | Default | What it does |
| --- | --- | --- |
| `--password` | `test1234` | Password every scrubbed user gets |
| `--keep EMAIL` | none | Leave these accounts untouched. Repeatable or comma-separated (`--keep a@x.com,b@x.com`). Use it for your own admin login |
| `--dry-run` | off | Print counts, then roll back |
| `--force` | off | Run outside `development`/`preview` |

Log in afterwards as `user<id>@nexus.dev` / `test1234`. Ids are in the
`users` table.

---

## Full workflow: prod → new test environment

Order matters. The test backend must not be running until step 6. Otherwise
real emails and live sessions sit in a running app.

1. **Stop the test backend service** in Railway, so it neither holds
   connections nor recreates tables mid-restore.

2. **Get both public URLs.** Railway → each Postgres service → Variables →
   `DATABASE_PUBLIC_URL`. The internal `*.railway.internal` URL only resolves
   inside Railway.

3. **Dump prod.** Read-only, doesn't touch prod:
   ```bash
   pg_dump "<PROD_URL>" -Fc --no-owner --no-acl -f prod.dump
   ```
   The local `pg_dump` must be the same major version as Railway's server or
   newer. `--no-owner --no-acl` drops prod's role names, which don't exist on
   the test DB.

4. **Wipe and restore the test DB.** Irreversible. Check that the host in the URL
   is the test env's:
   ```bash
   psql "<TEST_URL>" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
   pg_restore -d "<TEST_URL>" --no-owner --no-acl --single-transaction --exit-on-error prod.dump
   ```
   Drop the schema rather than using `pg_restore --clean`. `--clean` only drops
   what's in the dump, so tables the branch added would survive and collide
   with the next migration.

5. **Migrate, then scrub:**
   ```bash
   cd backend
   export DATABASE_URL="<TEST_URL>" APP_ENV=preview
   uv run alembic upgrade head
   uv run python -m app.db.anonymize_users --keep <your-email> --dry-run
   uv run python -m app.db.anonymize_users --keep <your-email>
   ```
   Real environment variables take precedence over `.env`, so this hits Railway,
   not the local DB.

6. **Disable sheet sync, then start the backend.** `sheet_configs` still point
   at prod's Google Sheets:
   ```bash
   psql "<TEST_URL>" -c "UPDATE sheet_configs SET is_active = false;"
   ```
   Also give the test env its own `JWT_SECRET`, not prod's.

7. **Delete `prod.dump`.** It's full prod PII. Never commit it.

---

## What it doesn't cover

- **Free-text PII in form answers.** If a form asks for an emergency contact or
  a second phone number, those answers are copied as-is.
- **Names.** Kept deliberately so the roster stays readable. If the copy is going
  to be shared beyond the team, this script isn't enough.
