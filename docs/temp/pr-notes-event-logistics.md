# PR notes: feat/event-logistics

Temporary — remove before merging.

## Migration tested against a prod copy

Restored a redacted dump of prod (Postgres 17, at revision `d3b71a4c9e02`) into a throwaway local database and ran `alembic upgrade head` through all three new migrations (`6a3b32e96e8c`, `9beadc61ad5a`, `5b5c2f46ad06`). No errors, and neither built-in check (permissions unchanged, no role lost) tripped.

- Every row in `tournament_membership_roles` (7 of 7) moved to `tournament_track_assignments` as tournament-wide, since each role carries permissions.
- Every member's permissions are unchanged, read back through the app's models.
- The three old tables were dropped only after the checks passed.
- Prod has no events, shifts, staffing or zones yet, so those paths were tested on scratch databases instead. That testing found staffing rows on a track their event wasn't linked to, which aborted the upgrade; the migration now repairs those links first.

Redaction: sessions, verification tokens and the audit log were left out of the dump; user emails, names, phone, password hash, date of birth, dietary restriction, major, employer and pronouns were replaced after restoring. The copy was deleted afterwards.

## Deploying

- Take a fresh prod backup right before deploying.
- Avoid downgrading. The downgrade now puts roles and staffing back into the old tables, but the old model has no per-track scope, so a later upgrade re-derives it and some roles can come back with a different scope.
