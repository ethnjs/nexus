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

`type(scope): summary` — one line, no bullet body. `type` is `feat`/`fix`/`refactor`/`docs`/`style`/`test`/`chore`; `scope` is the area touched (`forms`, `tournament`, `ui`, `db`, etc).

```
feat(forms): add branching validation for single/multi-select
fix(db): enable pool_pre_ping to survive Railway's idle connection drops
```

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
