# Contributing to NEXUS

## Local setup

**Requirements:** [uv](https://docs.astral.sh/uv/getting-started/installation/) (installs the Python version pinned in `backend/.python-version`), Node with pnpm, and [Docker Desktop](https://www.docker.com/products/docker-desktop/). Google Sheets features also need a Google service account credentials file.

### 1. Database

From `backend/`:

```bash
docker-compose up -d
```

This starts Postgres 16 on `localhost:5432` with database, user and password all `nexus`. On first boot it also creates the `nexus_test` database the test suite uses. Any Postgres GUI works for inspecting it ([TablePlus](https://tableplus.com/)'s free tier is plenty).

### 2. Backend

From `backend/`:

```bash
uv sync
cp .env.example .env
uv run uvicorn app.main:app --reload --port 8001
```

In development, startup runs `alembic upgrade head` and seeds these accounts:

- `admin@nexus.dev` / `admin1234`: site admin
- `user1@nexus.dev` through `user15@nexus.dev` / `user1234`: regular users, with no tournaments

API docs are at [localhost:8001/docs](http://localhost:8001/docs) (Swagger) and [localhost:8001/reference](http://localhost:8001/reference) (Scalar). Both are served only when `APP_ENV` is `development` or `preview`. Production serves only the spec at `/openapi.json`, which the docs site renders.

Email (verification, password reset, invites) is sent through Amazon SES and needs `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; `.env.example` lists the other SES settings. Without the keys, development logs each email, including its links, instead of sending it. The seeded accounts don't need it. To see every email as recipients do, see [backend/docs/email-previews.md](backend/docs/email-previews.md).

Add dependencies with `uv add <pkg>`, or `uv add --dev <pkg>` for dev-only tools. Commit `pyproject.toml` and `uv.lock` together, and never edit either one's versions by hand.

### 3. Frontend

From `frontend/`:

```bash
pnpm install
pnpm dev
```

No `.env.local` is needed. The browser talks to the Next.js route `/api/proxy`, which forwards to `API_URL` (default `http://localhost:8001`) and attaches `API_KEY` as the `X-API-Key` header. Both are server-only variables. Set `API_URL` in `frontend/.env.local` only if the backend runs on another port. Leave `API_KEY` unset in both apps locally: the backend skips the check in development when its own `API_KEY` is empty.

### 4. Git hooks

Run once per clone, from the repo root:

```bash
git config core.hooksPath .githooks
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

- **pre-commit** lints and formats staged backend files with Ruff, applying safe fixes. CI runs the same checks. To run them by hand from `backend/`: `uv run ruff check --fix` and `uv run ruff format`.
- **post-checkout** gives each git worktree its own database (`scripts/setup-worktree-db.sh`), so branches with different migrations don't collide. The main checkout keeps the default `nexus` database.

### Tests

From `backend/`:

```bash
uv run pytest tests/api/test_forms.py   # one file
uv run pytest                           # everything (about 15 minutes)
```

Tests run against `nexus_test`. Each test rolls back its own transaction, and Google APIs and email are mocked. CI runs Ruff and the full suite on every PR that touches `backend/`.

The frontend has no test suite. Check UI changes by clicking through them in a browser, and run `pnpm lint` and `pnpm exec tsc --noEmit`.

### Migrations

Every model change ships with a migration in the same PR. From `backend/`:

```bash
uv run alembic revision --autogenerate -m "description"
uv run alembic upgrade head
```

Read the generated file before committing; autogenerate misses some changes and gets others wrong. Never edit or delete a migration that has been pushed, because preview databases may already be on it. Add a new revision instead, or an `alembic merge` revision when two branches both added one.

---

## Workflow

1. **Open an issue first** with the Bug report or Feature/task template. Scope and approach get settled there.
2. **Branch off `main`** and link the branch to the issue (the issue's Development sidebar), so merging the PR closes it.
3. **Open a PR into `main`.** Nothing is committed to `main` directly.
4. **Get an approval from the other maintainer** before merging, every time.

### Branch names

- `feat/short-description`: new functionality
- `fix/short-description`: bug fix
- `refactor/short-description`: no behavior change
- `docs/short-description`: docs only

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), on one line with no body: `type(scope): summary`. The scope is optional and names the area (`forms`, `tracks`, `db`, `ui`). Don't repeat it in the summary.

```
feat(forms): add branching validation for single and multi select
fix(db): enable pool_pre_ping to survive Railway's idle connection drops
feat(api)!: rename /tournaments/{id}/members to /memberships
```

semantic-release reads the types on `main` to pick the next version, so choose the type by what the change does for users. A fix labeled `chore` never ships in a release.

| Type | Use for | Version bump |
|---|---|---|
| `feat` | New user-facing functionality | minor |
| `fix` | Bug fix | patch |
| `perf` | Performance improvement | patch |
| `refactor` | Code change with no behavior change | none |
| `docs` | Docs only | none |
| `style` | Formatting only | none |
| `test` | Tests only | none |
| `build` | Dependencies, build tooling, release config | none |
| `ci` | GitHub Actions workflows | none |
| `chore` | Anything else that doesn't ship | none |

Mark a breaking change with `!` after the type or scope (`feat!:`, `fix(api)!:`). It bumps the major version.

### Pull requests

`.github/pull_request_template.md` fills in the description, and its comments explain each section. In short:

- One line per bullet, and don't hard-wrap lines. GitHub wraps them.
- Lead with what changed. Give a reason only when the change looks wrong without one.
- Describe migrations by what they do to the data, with the revision hash in trailing parens. Start any bullet that drops rows or columns with **Destroys data:**.
- Delete sections that don't apply instead of writing "N/A".

Before requesting review, make sure that:

- tests pass,
- every model change has a migration,
- and you've clicked through any UI change in a browser.

---

## Releases

Versions follow SemVer and are computed by semantic-release from the commits since the last tag. Nothing is released on merge, and versions are never bumped by hand.

- Every release during the pilot year carries a flat `-beta` suffix (`v1.4.0-beta` → `v1.5.0-beta`), set by `tagFormat` in `.releaserc.json`.
- The release commit (`chore(release)`) writes the version to `backend/VERSION`, which the API reports, and `frontend/package.json`.
- The GitHub release lists the commits. The hand-written release notes in `docs/release-notes/` are for the people using NEXUS. No `CHANGELOG.md` is kept.

### Cutting a release

**1. Preview the next tag** from an up-to-date `main`:

```bash
GITHUB_TOKEN=$(gh auth token) npx \
  -p node@24 \
  -p semantic-release@25 \
  -p @semantic-release/exec@7 \
  -p @semantic-release/git@11 \
  -p conventional-changelog-conventionalcommits@9 \
  semantic-release --dry-run --no-ci
```

**2. Write the release notes** for that tag, in plain language for tournament directors and volunteers:

```bash
cp .github/RELEASE_NOTES_TEMPLATE.mdx docs/release-notes/<tag>.mdx
```

Use one page per release; if the page for the pending tag already exists, add to it. Merge it into `main`, then preview again, because a `feat` or `fix` merged in between changes the tag.

**3. Run the Release workflow:**

```bash
gh workflow run release.yml
```

It tags the release, publishes the GitHub release with a link to the notes page, and syncs the docs site.

---

## Docs site content

`docs/` holds the NEXUS pages of the docs site ([docs.ethanshih.com](https://docs.ethanshih.com)), under `/nexus`. It syncs on every push to `main` that touches `docs/`, and again at each release. The docs site owns the sidebar config (`meta.json`) and the release notes landing page.

- **Pages** are `.mdx` files. Every `.md` or `.mdx` file in `docs/` becomes a public page, so keep notes and READMEs out of it. `docs/temp/` is gitignored for private notes.
- **Images** go next to the page that uses them, imported relatively (`![Setup](./setup.png)`).
- **Videos** go in `docs/public/` and are referenced from the site root (`/nexus/demo.mp4`).
- **Release notes** go in `docs/release-notes/<tag>.mdx`. In the frontmatter, `title` is the tag, `description` is a one-line summary, and `date` is the release time in ISO 8601 with a UTC offset (`2026-09-15T14:30:00-07:00`). The site orders releases by `date`.

Design notes for developers live in `backend/docs/`, which is not synced.
