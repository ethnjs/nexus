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
| Database | SQLite (dev), PostgreSQL (prod) |
| Frontend | Next.js 15, React, TypeScript, TailwindCSS |
| Auth | JWT (httpOnly cookie) + API key |
| Integrations | Google Sheets API (service account) |
| Hosting | Railway (backend), Vercel (frontend) |

---

## Project Structure

```
nexus/
├── backend/        # FastAPI app
│   ├── app/
│   │   ├── api/routes/     # Auth, tournaments, events, memberships, sheets
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

**Requirements:** Python 3.13, a Google service account credentials file

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file:
```
APP_ENV=development
DATABASE_URL=sqlite:///./nexus.db
GOOGLE_SERVICE_ACCOUNT_FILE=./credentials.json
API_KEY=
JWT_SECRET=dev-secret-change-in-production
```

Run the server:
```bash
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

```bash
cd backend
pytest
```

Tests use an in-memory SQLite database and mock out the Google Sheets API — no external services required.

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

## Deployment

### Backend (Railway)
- Root directory: `backend`
- Start command defined in `Procfile`
- Required env vars: `APP_ENV`, `DATABASE_URL`, `API_KEY`, `JWT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`

### Frontend (Vercel)
- Root directory: `frontend`
- Required env vars (server-side only): `API_URL`, `API_KEY`
- All API calls are proxied through `/api/proxy` — the API key is never exposed to the browser

---

## Architecture Notes

**Permissions** are membership-based, not role-based. A user can be a tournament director for one tournament and a volunteer in another simultaneously. Access within a tournament is determined by `Membership.positions` (e.g. `tournament_director`, `lead_event_supervisor`) which map to permission keys like `manage_volunteers` and `view_events`.

**Sheet sync** upserts users and memberships by email. Contiguous availability slots are merged automatically. Synced volunteers start with no system permissions — TDs assign positions manually.

**All routes** require an `X-API-Key` header (skipped in development when `API_KEY` is blank). Auth routes additionally issue a JWT as an httpOnly cookie.

---

## Contributing

All changes to `main` must go through a pull request. Direct pushes are blocked.

1. Branch off `main`
2. Make your changes
3. Open a PR against `main`
4. Merge after review