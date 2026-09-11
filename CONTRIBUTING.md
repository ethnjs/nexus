# Contributing to NEXUS

## Getting started

**Requirements:** Python 3.13, Node/pnpm, [Docker Desktop](https://www.docker.com/products/docker-desktop/), a Google service account credentials file.

### 1. Start the database

NEXUS runs Postgres locally via Docker instead of a native install. Install Docker Desktop, then from `backend/`:

```bash
cd backend
docker-compose up -d
```

This starts a single `postgres:16` container (service `db` in `docker-compose.yaml`) on port `5432`, with a `nexus` database/user/password all set to `nexus`. It also auto-creates a second `nexus_test` database on first boot (used by the test suite) — no manual step needed, including after `docker-compose down -v`.

To actually look at what's in the database — tables, rows, whether a migration did what you think it did — [TablePlus](https://tableplus.com/) is a good GUI client for this; the free tier is more than enough for local dev. Connect to `localhost:5432`, db `nexus`, user/password `nexus`.

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # fill in GOOGLE_SERVICE_ACCOUNT_FILE at minimum
alembic upgrade head
uvicorn app.main:app --reload --port 8001
```

Swagger UI: [http://localhost:8001/docs](http://localhost:8001/docs)

API reference (Scalar): [http://localhost:8001/reference](http://localhost:8001/reference)

Both UIs are served only when `APP_ENV` is `development` or `preview`. In production the API serves just the spec at `/openapi.json`, which the docs site renders.

Dev seed accounts (created automatically on startup):
- `admin@nexus.dev` / `admin1234` — admin
- `user1@nexus.dev` .. `user15@nexus.dev` / `user1234` — regular users, no tournament seeded

### 3. Frontend

```bash
cd frontend
pnpm install
```

Create `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8001
```

```bash
pnpm dev
```

### Running tests

```bash
cd backend
pytest
```

Runs against the `nexus_test` Postgres database from step 1. Each test rolls back its own transaction, so the test DB never accumulates data. The Google Sheets API is mocked — no external services required.

### Database migrations

Any model change needs a migration:
```bash
cd backend
alembic revision --autogenerate -m "description"
alembic upgrade head
```

---

## Workflow

1. **Open an issue first**, using the Bug report or Feature/task template. This is where scope/approach gets discussed before code exists.
2. **Branch off `main`**, named to match what the issue covers (see naming below).
3. **Link the branch to the issue** via the issue's "Development" sidebar (or "Create a branch" from the issue itself) — with that link in place, merging the PR closes the issue automatically.
4. **Open a PR back into `main`.** No direct commits to `main`.
5. **Get a review and approval from the other contributor before merging.** This applies every time, not just for large changes.

### Branch naming

Match the existing convention:
- `feat/short-description` — new functionality
- `fix/short-description` — bug fix
- `refactor/short-description` — no behavior change
- `docs/short-description` — docs only

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary` — one line, no bullet body. `scope` is optional and names the area touched (`forms`, `tournament`, `ui`, `db`, etc).

```
feat(forms): add branching validation for single/multi-select
fix(db): enable pool_pre_ping to survive Railway's idle connection drops
feat(api)!: rename /tournaments/{id}/members to /memberships
```

The `type` matters: release-please reads commit messages on `main` to pick the next version and write the changelog.

| Type | Use for | Version bump |
|---|---|---|
| `feat` | New user-facing functionality | minor |
| `fix` | Bug fix | patch |
| `perf` | Performance improvement, no behavior change | patch |
| `refactor` | Code change, no behavior change | none |
| `docs` | Docs only | none |
| `style` | Formatting only | none |
| `test` | Tests only | none |
| `build` | Dependencies, build tooling, release config | none |
| `ci` | GitHub Actions workflows | none |
| `chore` | Anything else that doesn't ship | none |

**Breaking changes** bump major. Mark them with `!` after the type/scope (`feat!:`, `fix(api)!:`) — this keeps the message single-line. A `BREAKING CHANGE: <description>` footer is also recognized, but prefer `!`.

Pick the type by what the change *does for users*, not by what files it touches — a `fix` that's mislabeled `chore` never gets released.

### Versioning

- SemVer. `.release-please-manifest.json` tracks the released version; release-please writes it to `frontend/package.json` and `backend/VERSION` (the API's OpenAPI version reads from the latter).
- During the pilot year, every release carries a flat `-beta` suffix, not an incrementing `beta.N`. The core number still moves normally: `v1.0.0-beta` → `v1.1.0-beta` on a `feat`, → `v1.0.1-beta` on a `fix`.
- Versions are never bumped by hand — release-please opens a release PR, and merging it tags the release.

### Before opening a PR

- `pytest` passes locally.
- If you touched any SQLAlchemy models, a matching Alembic migration is included.
- If you touched frontend UI, you've actually clicked through the change in a browser — type checking isn't a substitute for looking at it.

### PR description

Cover, briefly:
- **Summary** — what this does and why.
- **What changed** — grouped by area (backend/frontend, or by subsystem) if it's more than a couple files.
- **Out of scope** — anything the linked issue implied but this PR deliberately doesn't do.
- **Test plan** — what you ran, what you checked by hand.

---

## Docs content

`docs/` holds the NEXUS pages for the docs site ([docs.ethanshih.com](https://docs.ethanshih.com)). On each release it's synced into the docs site under `/nexus`. It holds content only — the docs site owns the folder name, sidebar config (`meta.json`), and the changelog landing page.

- **Pages** — `.mdx` files. Every `.md`/`.mdx` file becomes a live page, so don't leave READMEs or notes in `docs/`.
- **Images** — next to the page that uses them, imported relatively (`![Setup](./setup.png)`).
- **Videos** — in `docs/public/`, referenced from the site root (`/nexus/demo.mp4`).
- **Changelog** — `docs/changelog/`, one manually written page per release, named after the release tag (`v1.0.0-beta.mdx`). Frontmatter: `title` is the tag, `date` is the release date and time in ISO 8601 with a UTC offset (`2026-09-15T14:30:00-07:00`) — the docs site orders releases by it.
