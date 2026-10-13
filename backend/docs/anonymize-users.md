# Anonymizing a prod copy

`app/db/anonymize_users.py` scrubs contact details and passwords from a database restored from prod. A test environment can then run on real tournament data without being able to email, text, or log in as real people.

```bash
cd backend
DATABASE_URL="<test DB public URL>" APP_ENV=preview \
  uv run python -m app.db.anonymize_users --keep <your-email>
```

It refuses to run unless `APP_ENV` is `development` or `preview`.

## What it changes

| Column | Becomes |
| --- | --- |
| `users.email` | `user<id>@nexus.dev` |
| `users.phone` | `555-<id, zero-padded to 7>`. Blank phones stay blank. |
| `users.hashed_password` | the hash of `--password` (default `test1234`) |
| `sessions`, `verification_tokens` | truncated |

Names, profiles, form responses and every id are left as they are.

- **Ids are never changed.** Track, shift and event ids are embedded in form field keys (`availability_7`, `lunch_7_veg`), field configs, answer values, display configs, export presets and form prerequisites. Scrubbing in place keeps them all valid. Remapping ids would mean rewriting them inside JSON, and a missed one fails silently.
- **`nexus.dev`** matches the dev seed accounts and is unregistered, so an email sent from the copy bounces. Don't use `.test`: Pydantic's `EmailStr` rejects special-use TLDs, so every response containing a user email would fail validation.
- **Sessions and tokens are truncated** because prod sessions mean nothing on the copy, and an unused password-reset token would let someone set a password there.

## Flags

| Flag | Default | What it does |
| --- | --- | --- |
| `--password PW` | `test1234` | Password every scrubbed user gets |
| `--keep EMAIL` | none | Leave these accounts untouched, such as your own admin login. Repeatable or comma-separated. |
| `--dry-run` | off | Print counts, then roll back |
| `--force` | off | Run outside `development`/`preview`. There's no reason to use it. |

Afterwards, log in as `user<id>@nexus.dev` / `test1234`.

## Prod to a new test environment

Keep the test backend stopped until step 6, so real emails and live sessions never sit in a running app.

1. **Stop the test backend service** in Railway, so it neither holds connections nor migrates mid-restore.
2. **Get both public database URLs:** Railway → each Postgres service → Variables → `DATABASE_PUBLIC_URL`. The `*.railway.internal` URL only resolves inside Railway.
3. **Dump prod.** This is read-only. The local `pg_dump` must be the same major version as Railway's server, or newer.
   ```bash
   pg_dump "<PROD_URL>" -Fc --no-owner --no-acl -f prod.dump
   ```
4. **Wipe and restore the test database.** This is irreversible, so check that the host is the test environment's.
   ```bash
   psql "<TEST_URL>" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
   pg_restore -d "<TEST_URL>" --no-owner --no-acl --single-transaction --exit-on-error prod.dump
   ```
   Drop the schema instead of using `pg_restore --clean`, which only drops what's in the dump. Tables added by the branch would survive and collide with its next migration.
5. **Migrate, then scrub.** Real environment variables override `.env`, so this hits Railway, not the local database.
   ```bash
   cd backend
   export DATABASE_URL="<TEST_URL>" APP_ENV=preview
   uv run alembic upgrade head
   uv run python -m app.db.anonymize_users --keep <your-email> --dry-run
   uv run python -m app.db.anonymize_users --keep <your-email>
   ```
6. **Turn off sheet sync, then start the backend.** `sheet_configs` still point at prod's Google Sheets.
   ```bash
   psql "<TEST_URL>" -c "UPDATE sheet_configs SET is_active = false;"
   ```
7. **Delete `prod.dump`.** It's full prod PII. Never commit it.

## What it doesn't cover

- **Free-text answers** are copied as-is, so an emergency contact or second phone number asked for in a form survives.
- **Names** are kept so the roster stays readable. If the copy will be shared beyond the team, this script isn't enough.
