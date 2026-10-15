# Backend

Run everything from `backend/` through uv (`uv run ...`); bare `python` may not be the project venv.

```bash
uv run uvicorn app.main:app --reload --port 8001
uv run python -u -m pytest tests/api/test_forms.py -q   # see "Running tests" in root CLAUDE.md
uv run ruff check --fix && uv run ruff format          # the pre-commit hook and CI run the same
uv run ty check                                        # likewise
uv run alembic revision --autogenerate -m "description"
```

Ruff is the linter and formatter (config in `pyproject.toml`; line length 100), and ty the type checker (config in `ty.toml`). Annotate new functions' parameters and return types. Narrow an optional value with an `is not None` check or `assert`, and keep `# ty: ignore[rule]` for checker limits, not real type errors. Use modern syntax (`X | None`, built-in generics, PEP 695 generics); Ruff's `UP` rules enforce most of it.

## Layout

- `app/api/routes/`: routers, with `tournament/` and `chapter/` subpackages, one file per resource. Routers aren't auto-discovered: register a new one in `app/main.py` with `dependencies=[api_key_dependency]`.
- `app/core/`: business logic, roughly mirroring the routes (`core/tournament/`, `core/form/`).
- `app/schemas/`: Pydantic request and response models, mirroring the routes.
- `app/models/models.py`: every model, in one file.
- `app/services/`: Google Sheets and Forms clients, sheet sync, and email (Amazon SES). Every email goes through `email_service._send()`, which the tests' autouse `mock_send_email` patches; keep new senders going through it.
- `app/db/`: session, startup seeding, and dev scripts (`seed_members.py`, `anonymize_users.py`, documented in `docs/`).
- `scripts/render_emails.py`: renders every email to `tmp_emails/` for previewing without sending; see `docs/email-previews.md`. Add new senders to it.

## Routes

- Every path ends in `/`. With `redirect_slashes=False`, a request without the trailing slash gets a 404.
- Routes are sync `def` with a sync `Session` from `Depends(get_db)`. Queries use `db.query(...)` throughout; match that rather than mixing in `select()`.
- Declare `response_model`. Schemas exist per *audience* (who may see the data), not per screen or caller.
- Prefer fewer, query-shaped routes over one route per screen. Before adding a route, check whether a query parameter on an existing one covers it. When callers want different amounts of the same data, add a `fields` query: omitting it returns everything, and an unrequested group is absent from the JSON, while `null` always means "no value".
- Gate access on the route with permission dependencies. Don't build a full response and redact it afterwards.
- Look up tournament-scoped rows with `get_scoped_or_404(db, Model, id, tournament_id, "Label")`. It returns 404 for both missing and cross-tournament rows, so ids can't be probed.
- Every tournament write route calls `get_tournament()` then `require_not_archived()`. Archived tournaments stay readable, so neither dependency enforces it. Form write routes call `require_form_not_archived()`.
- Core helpers raise `HTTPException` directly (`require_*`, `get_*_or_404`). The exception is form validation, which raises `FormFieldValidationError` (a `ValueError`) for routes to turn into a 422.
- Writes to an audited tournament action call `log_action()` before `db.commit()`; see `.claude/rules/audit-log.md`.

## Auth (`app/core/auth.py`)

- Sessions are opaque random tokens, not JWTs. The raw token is in the httpOnly `access_token` cookie; only its SHA-256 hash is stored on a `UserSession` row, with a fixed 7-day expiry.
- Use `get_current_user` / `get_current_session` as dependencies. `require_admin` is for site-wide admin routes only.
- Every router also requires the `X-API-Key` header, which the frontend proxy attaches. The check is skipped in `development` and `test` when `API_KEY` is empty.

## Tournament permissions (`app/core/tournament/permissions.py`)

- Permissions are the `MANAGE_*` constants. `DEFAULT_ROLES` is a template applied on demand (`.../roles/apply-template/`); new tournaments start with no roles. To add a permission, add the constant, add it to the right default roles, and gate routes with it.
- The tournament owner (`Tournament.owner_id`) and site admins hold every permission implicitly.
- Roles are held through `TournamentTrackAssignment` rows; there's no membership-role table. A row is either tournament-wide (`is_tournament_wide`, with no track, event, shift or zone) or scoped to a track and optionally to an event, shift or zone. Holding a role and being staffed are the same row. Read roles through `TournamentMembership.held_roles`, `held_role_details` or `roles_on_track()`. Permissions and rank are track-blind: a role held on any track grants its permissions tournament-wide.
- Route dependencies:
  - `require_membership()` returns 404, not 403, to non-members.
  - `require_permission(P)`.
  - `require_any_permission(*perms)` covers a resource two different jobs both need.
  - `require_catalog_read(P)` splits member reads from staff reads with `?public=true`.
- Without `manage_members` or ownership, a user can read only their own membership, through `/members/me/`.
- Chapter roles (`app/core/chapters.py`) are a separate, simpler system: `ChapterMembership.role` is `"lead"` or `"officer"`, checked by `require_lead`, `require_officer_or_lead` and `require_chapter_lead_or_admin`.

## Domain notes

- `Tournament` has no date, location or division columns. Those come from its primary `TournamentTrack`s, exposed through properties on `Tournament`.
- A zone's event list is derived on every read from its rules (a building, or a floor of one) plus explicitly added events; it's never stored. See the module docstring in `core/tournament/zones.py`.
- Forms are the most intricate area. `.claude/rules/forms.md` loads when you touch them.

## Config and startup

- Read settings with `get_settings()`, which is cached; never instantiate `Settings()`. `app_env` is `development`, `preview`, `production` or `test`.
- Startup (skipped under pytest) always seeds canonical events, categories and universities. In `development` and `preview` it also runs `alembic upgrade head` and seeds the dev accounts. It schedules `archive_ended_tournaments` daily at 00:05 UTC. Production migrates in the `Procfile` before starting.
