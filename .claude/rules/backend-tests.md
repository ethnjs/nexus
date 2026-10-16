---
paths:
  - "backend/tests/**"
---

# Backend tests

When to run and write tests is under "Tests" in `backend/CLAUDE.md`.

- Tests use real Postgres (`TEST_DATABASE_URL`, default `nexus_test`). The schema is built once per run from `Base.metadata.create_all`, not migrations.
- Each test runs inside a transaction that's rolled back at teardown (the `db` fixture), so no cleanup is needed.
- The layout mirrors `app/`: `tests/api/` follows `app/api/routes/`, `tests/core/` follows `app/core/`, and `tests/services/` follows `app/services/`. Put a new test next to its siblings.
- Fixtures in `tests/conftest.py`:
  - `admin_user` is a site admin, so it bypasses permission checks.
  - `td_user` + `td_tournament`: a tournament owned by `td_user`, with `DEFAULT_ROLES` applied and the Tournament Director role held tournament-wide.
  - `other_user` + `other_tournament` are for cross-tenant isolation tests.
  - `client` and `login(client, email, password)`. `client` expires the session after every request, as production starts each request with a fresh one, so flush or commit setup before making a request.
  - `event_factory`, `event_category_factory`.
- Helpers in `tests/conftest.py`:
  - `grant_role(db, tournament, user, "Role Label", track_id=None)` creates a `TournamentTrackAssignment`, tournament-wide unless `track_id` is given.
  - `primary_track_id(db, tournament_id)` returns a track to attach events and shifts to.
  - `future_date(month, day)` / `FUTURE_YEAR`. Never hardcode dates; tournament creation rejects past dates.
  - `TOURNAMENT_REQUIRED_FIELDS` is the minimal create payload.
- Google Sheets and Forms are mocked through `app.dependency_overrides` (`mock_sheets_service`, `mock_forms_service`). Email is stubbed by the autouse `mock_send_email`, which patches `app.services.email_service._send`. If you change how `email_service` sends, keep every sender going through the patched function; a bypassed mock doesn't fail tests, it sends real email.
- Discord is off under pytest. The `discord_on` fixture turns it on with dev-shaped settings. Discord's OAuth API is stubbed by the autouse `mock_discord_http`, which patches `app.services.discord.oauth._request` and fails any call a test hasn't stubbed through `side_effect`.
- Test behavior through the API (`client`) where a route exists; reserve `tests/core/` for logic with no route of its own or with many edge cases.
