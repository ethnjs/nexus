# NEXUS

A full-stack web dashboard for Science Olympiad tournament directors to manage volunteer logistics, event assignments, and tournament data.

**Data flow:** Google Forms → Google Sheets → NEXUS

**Live:** [nexus.ethanshih.com](https://nexus.ethanshih.com)

---

## What it does

Tournament directors use NEXUS to:
- Connect a Google Sheets interest form and sync volunteer responses into the system
- Manage events, time blocks, and volunteer assignments for a tournament
- Track volunteer availability, preferences, and assignment status
- Assign volunteers to events via a drag-and-drop dashboard

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.13, FastAPI, SQLAlchemy, Alembic |
| Database | PostgreSQL (dev via Docker, prod via Neon) |
| Frontend | Next.js 15, React, TypeScript, TailwindCSS |
| Auth | JWT (httpOnly cookie) + API key |
| Integrations | Google Sheets API (service account) |
| Hosting | Render (backend), Vercel (frontend) |

---

## Project Structure

```
nexus/
├── backend/        # FastAPI app
│   ├── app/
│   │   ├── api/routes/     # Auth, users, tournaments, events, event categories, sheets
│   │   ├── core/           # Config, auth, permissions
│   │   ├── db/             # Session, migrations
│   │   ├── models/         # SQLAlchemy ORM models
│   │   ├── schemas/        # Pydantic schemas
│   │   └── services/       # Google Sheets, sync logic
│   ├── alembic/            # DB migrations
│   └── tests/              # Pytest test suite
└── frontend/       # Next.js app
    ├── app/                # Pages (dashboard, tournament views)
    ├── components/         # UI + layout components
    └── lib/                # API client, auth + tournament hooks
```

---

## Local Development

### Backend

**Requirements:** Python 3.13, Docker, a Google service account credentials file

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
docker-compose up -d
```

Create a `.env` file:
```
APP_ENV=development
DATABASE_URL=postgresql://nexus:nexus@127.0.0.1:5432/nexus
GOOGLE_SERVICE_ACCOUNT_FILE=./credentials.json
API_KEY=
JWT_SECRET=dev-secret-change-in-production
```

Run the server:
```bash
alembic upgrade head
uvicorn app.main:app --reload --port 8001
```

Swagger UI: [http://localhost:8001/docs](http://localhost:8001/docs)

API reference (Scalar): [http://localhost:8001/reference](http://localhost:8001/reference)

Dev seed accounts (created automatically on startup):
- `admin@nexus.dev` / `admin1234`
- `td@nexus.dev` / `td1234`

### Frontend

```bash
cd frontend
pnpm install
```

Create a `.env.local` file:
```
NEXT_PUBLIC_API_URL=http://localhost:8001
```

Run the dev server:
```bash
pnpm dev
```

---

## Running Tests

Tests run against a dedicated `nexus_test` Postgres database on the same Docker container as dev — this keeps test transaction/rollback semantics identical to prod (SQLite doesn't support the savepoints the test fixtures rely on). Create it once:

```bash
docker exec backend-db-1 createdb -U nexus nexus_test
```

Then run:
```bash
cd backend
pytest
```

Each test runs inside a transaction that's rolled back at teardown, so the test DB never accumulates data. Override the target with `TEST_DATABASE_URL` if needed. The Google Sheets and Forms APIs are mocked — no external services required.

---

## Database Migrations

```bash
cd backend
alembic upgrade head
```

To create a new migration after changing models:
```bash
alembic revision --autogenerate -m "description"
```

---

## Contributing

### Branch strategy

We use a three-tier model:

```
feature/your-feature  →  staging  →  main
```

- **`main`** — production only. Never commit directly.
- **`staging`** — integration branch. All feature branches merge here first, get tested, then get promoted to `main`.
- **feature branches** — one per feature, branched off `staging`.

### Workflow

```bash
# Start a new feature
git checkout staging
git pull origin staging
git checkout -b feature/your-feature

# ... do work ...

# Open a PR targeting staging (not main)
# After review and merge, test on the Vercel preview URL
# When staging is stable, open a PR from staging → main (requires 1 approval)
```

### Rules

- PRs are required to merge into both `staging` and `main` — no direct commits
- Merging to `main` requires approval from the other contributor
- Force pushes and deletions are blocked on both branches
- The GitHub default branch is `staging` — new PRs will pre-select it as the base

### Deployment

**Backend (Render)**
- Root directory: `backend`
- Start command defined in `Procfile`
- `DATABASE_URL` points at the Neon Postgres instance
- Required env vars: `APP_ENV`, `DATABASE_URL`, `API_KEY`, `JWT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`

**Frontend (Vercel)**
- Root directory: `frontend`
- Required env vars (server-side only): `API_URL`, `API_KEY`
- All API calls are proxied through `/api/proxy` — the API key is never exposed to the browser
- Every branch push (including `staging`) gets a Vercel preview deployment automatically

---

## Architecture Notes

**Permissions** are membership-based, not role-based. A user can be a tournament director for one tournament and a volunteer in another simultaneously. Access within a tournament is determined by `TournamentMembership.positions` (e.g. `tournament_director`, `lead_event_supervisor`) which map to permission keys like `manage_volunteers` and `view_events`.

**Sheet sync** upserts users and memberships by email. Contiguous availability slots are merged automatically. Synced volunteers start with no system permissions — TDs assign positions manually.

**All routes** require an `X-API-Key` header (skipped in development when `API_KEY` is blank). Auth routes additionally issue a JWT as an httpOnly cookie.
