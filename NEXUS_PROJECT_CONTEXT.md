# Nexus — Science Olympiad Tournament Manager
## Project Context Document
*Last updated: phase-8-merged + preview environments set up*

---

## Overview
Full-stack web dashboard for Science Olympiad tournament directors to manage volunteer logistics, event assignments, and tournament data. Data flows: **Google Forms → Google Sheets → Nexus app**.

- **Project name:** Nexus
- **Root directory:** `nexus/` with `backend/` and `frontend/` subdirectories
- **Backend working directory:** `nexus/backend/`
- **Run server:** `uvicorn app.main:app --reload --port 8001` (port 8000 is blocked)
- **Swagger UI:** `http://localhost:8001/docs`
- **Production API:** `https://nexus-api.ethanshih.com` (Railway, custom domain)
- **DB migrations:** `alembic upgrade head` (do NOT delete nexus.db anymore)

---

## Tech Stack
- **Backend:** Python 3.13, FastAPI, SQLAlchemy 2.0.36 (classic `Column()` style — NOT `Mapped[]`), SQLite (dev) / PostgreSQL (prod), Pytest
- **Frontend:** Next.js 15, React, TypeScript, TailwindCSS, Vercel
- **Google Sheets API:** service account credentials — file in dev (`credentials.json`), env var in prod (`GOOGLE_SERVICE_ACCOUNT_JSON`)
- **Hosting:** Railway (backend + PostgreSQL), Vercel (frontend) — may migrate to Render after Railway trial
- **Version control:** GitHub

---

## Domains
- **Frontend:** `nexus.ethanshih.com` → Vercel (prototype)
- **Backend:** `nexus-api.ethanshih.com` → Railway (prototype)
- **Future permanent domain:** `nexus.socalscioly.org`
- Domains managed through Vercel DNS

---

## Repository Structure
```
nexus/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI app, CORS, lifespan, router registration
│   │   ├── core/
│   │   │   ├── config.py              # Pydantic settings from .env
│   │   │   ├── security.py            # API key verification dependency
│   │   │   ├── auth.py                # JWT, bcrypt, get_current_user, require_admin
│   │   │   └── permissions.py         # Permission constants, DEFAULT_POSITIONS, get_user_permissions(), require_permission()
│   │   ├── db/
│   │   │   ├── session.py             # Engine, SessionLocal, get_db()
│   │   │   └── init_db.py             # create_all() + dev seed (skips during pytest)
│   │   ├── models/models.py           # All SQLAlchemy ORM models
│   │   ├── schemas/
│   │   │   ├── tournament.py          # Tournament schemas + TournamentBlock + PositionDefinition + VolunteerSchema
│   │   │   ├── event.py               # Event schemas
│   │   │   ├── user.py                # User schemas
│   │   │   ├── membership.py          # Membership schemas + AvailabilitySlot + ScheduleSlot
│   │   │   ├── sheet_config.py        # SheetConfig schemas + ColumnMapping + KNOWN_FIELDS + SyncResult
│   │   │   └── auth.py                # LoginRequest, RegisterRequest, UserResponse
│   │   ├── services/
│   │   │   ├── sheets_service.py      # Google Sheets API logic + header auto-detection
│   │   │   └── sync_service.py        # Sync logic: upsert users/memberships from sheet rows
│   │   └── api/routes/
│   │       ├── auth.py                # Login, logout, me, register
│   │       ├── tournaments.py         # Tournament CRUD — GET /tournaments/ (admin), GET /tournaments/me/, nested routes
│   │       ├── events.py              # Event CRUD — nested under /tournaments/{id}/events/
│   │       ├── users.py               # User CRUD (admin-only global) + GET /tournaments/{id}/users/{id}
│   │       ├── memberships.py         # Membership CRUD — nested under /tournaments/{id}/memberships/
│   │       └── sheets.py              # Sheet wizard + config CRUD + sync — nested under /tournaments/{id}/sheets/
│   ├── alembic/                       # Alembic migrations
│   │   ├── env.py                     # Wired to DATABASE_URL + models
│   │   ├── script.py.mako
│   │   └── versions/                  # Migration files
│   │       ├── b079268fceb2_initial_schema_with_auth.py
│   │       ├── f4e526de3a94_add_auth_fields.py
│   │       └── a1b2c3d4e5f6_membership_positions_schedule_user_role.py
│   ├── tests/
│   │   ├── conftest.py                # In-memory SQLite, fixtures: admin_user, td_user, other_user, td_tournament, other_tournament, client, login()
│   │   ├── api/
│   │   │   ├── test_auth.py
│   │   │   ├── test_tournaments.py
│   │   │   ├── test_events.py
│   │   │   ├── test_users.py
│   │   │   ├── test_memberships.py
│   │   │   ├── test_sheets.py
│   │   │   └── test_sync.py
│   │   └── services/
│   │       ├── test_sheets_service.py
│   │       └── test_sync_service.py
│   ├── conftest.py                    # Root conftest — sys.path fix
│   ├── alembic.ini
│   ├── Procfile                       # Railway start command
│   ├── pytest.ini
│   ├── requirements.txt
│   ├── .env
│   ├── .env.example
│   └── .gitignore
└── frontend/
    ├── app/
    │   ├── globals.css                # Design tokens, DM Mono + DM Sans + Instrument Serif
    │   ├── layout.tsx                 # Root layout
    │   ├── page.tsx                   # Landing page + login form
    │   └── dashboard/
    │       ├── layout.tsx             # AuthProvider only — no chrome
    │       ├── page.tsx               # Tournament card grid, own topbar (NEXUS wordmark + avatar)
    │       └── [tournamentId]/
    │           ├── layout.tsx         # TournamentProvider + Sidebar + Topbar + main
    │           ├── overview/page.tsx  # Blank for now
    │           ├── assignments/page.tsx
    │           ├── events/page.tsx
    │           ├── volunteers/page.tsx
    │           └── settings/page.tsx
    ├── components/
    │   ├── ui/
    │   │   ├── Button.tsx             # primary/secondary/ghost/danger, DM Sans, loading state
    │   │   ├── Input.tsx              # label, error, helper, 16px left padding
    │   │   ├── Card.tsx               # surface container
    │   │   └── Badge.tsx              # status badges (confirmed, declined, assigned, etc.)
    │   └── layout/
    │       ├── Sidebar.tsx            # Sticky, in normal flow, expandable 52px→192px, tournamentId prop
    │       └── Topbar.tsx             # Sticky, tournament dropdown (280px), user avatar, tournamentId prop
    ├── lib/
    │   ├── api.ts                     # ApiError, authApi, tournamentsApi, eventsApi, usersApi, membershipsApi, sheetsApi + full types
    │   ├── useAuth.tsx                # AuthProvider + useAuth hook
    │   └── useTournament.tsx          # TournamentProvider + useTournament hook, persists selection to localStorage
    ├── middleware.ts                  # Protect /dashboard/*, redirect if logged in on /
    │                                  # NOTE: exported as `proxy` (not `middleware`) per Vercel deprecation
    ├── tailwind.config.ts
    ├── next.config.ts
    ├── .env.local                     # NEXT_PUBLIC_API_URL=http://localhost:8001
    └── package.json
```

---

## Environment & Config

**.env (local dev):**
```
APP_ENV=development
APP_PORT=8001
DATABASE_URL=sqlite:///./nexus.db
GOOGLE_SERVICE_ACCOUNT_FILE=./credentials.json
API_KEY=                              # optional in dev — leave blank to skip auth
JWT_SECRET=dev-secret-change-in-production
```

**Railway production env vars (all required):**
```
APP_ENV=production
DATABASE_URL=<internal postgresql url from Railway>
API_KEY=<secret key>
JWT_SECRET=<strong random secret>
GOOGLE_SERVICE_ACCOUNT_JSON=<entire contents of credentials.json>
```

**Railway preview env vars:**
```
APP_ENV=preview
DATABASE_URL=<internal postgresql url from Railway preview postgres>
API_KEY=<same as production or separate key>
JWT_SECRET=<can share with prod or use separate>
GOOGLE_SERVICE_ACCOUNT_JSON=<same as production>
```

**Vercel production env vars:**
```
API_URL=https://nexus-api.ethanshih.com
API_KEY=<same as Railway production API_KEY>
```

**Vercel preview env vars:**
```
API_URL=https://nexus-preview.up.railway.app
API_KEY=<same as Railway preview API_KEY>
```

**frontend/.env.local:**
```
NEXT_PUBLIC_API_URL=http://localhost:8001
```

**Note:** `API_URL` and `API_KEY` are server-side only (not `NEXT_PUBLIC_*`) — they're used by the Next.js proxy route and never exposed to the browser.

**pytest.ini:**
```ini
testpaths=tests
asyncio_mode=auto
asyncio_default_fixture_loop_scope=function
pythonpath=.
filterwarnings =
    ignore::DeprecationWarning:jose
```

---

## Authentication

### API Key (direct API / Swagger access)
- **Method:** `X-API-Key` header on ALL routes (including auth routes)
- **Dev behavior:** if `APP_ENV=development` and `API_KEY` is blank, auth is skipped entirely
- **Prod behavior:** if `API_KEY` is missing from env, all requests get 403 (fail-closed)
- **Implementation:** `app/core/security.py` → `verify_api_key` dependency, applied to all routers in `main.py`

### JWT (frontend)
- **Method:** httpOnly cookie named `access_token`, 7-day expiry, HS256
- **Cookie flags by environment:**
  - `production` — `httpOnly=True`, `secure=True`, `samesite=none`, `domain=".ethanshih.com"`
  - `preview` — `httpOnly=True`, `secure=True`, `samesite=none`, `domain=None`
  - `development` — `httpOnly=True`, `secure=False`, `samesite=lax`, `domain=None`
- **Why preview needs `domain=None`:** frontend is on `.vercel.app`, backend is on `.railway.app` — different domains entirely. The Next.js proxy forwards the cookie server-side so the browser only ever sees the Vercel domain. `domain=None` scopes the cookie to the Vercel preview URL automatically.
- **Routes:** `/auth/login/`, `/auth/logout/`, `/auth/me/`, `/auth/register/` (admin-only)
- **Dependencies:** `get_current_user`, `require_admin` (site-wide), `require_permission(perm)` (tournament-scoped)
- **Frontend middleware:** checks cookie presence — no cookie → redirect to `/`, has cookie → allow through
- **Expired token handling:** `useAuth` calls `/auth/me/` on mount; 401 → redirect to `/`

### Dev seed accounts
- `admin@nexus.dev` / `admin1234` — role: `admin`, has `event_supervisor` membership in sample tournament
- `td@nexus.dev` / `td1234` — role: `user`, has `tournament_director` membership in sample tournament
- Seeded automatically on startup in development via `seed_dev_data()` in `init_db.py`
- **These do NOT exist in production**

### Production user bootstrap
- No self-registration — admin must create all accounts via `POST /auth/register/`
- All registered users get `role="user"` — admin role must be set directly in DB
- First admin account must be inserted directly into the DB via psql

---

## Permission System (`app/core/permissions.py`)

Tournament-level access is determined entirely by `Membership.positions` and the permission definitions in `Tournament.volunteer_schema["positions"]`. `User.role` only distinguishes `admin` (site-wide superuser) from `user` (everyone else).

### Permission keys
| Permission | Access |
|---|---|
| `manage_tournament` | Full access to everything in this tournament — superset of all others |
| `manage_volunteers` | Read + write volunteer/membership pages |
| `manage_events` | Read + write events page |
| `manage_materials` | Read + write materials page (future) |
| `manage_logistics` | Read + write logistics page (future) |
| `view_volunteers` | Read-only volunteer list |
| `view_events` | Read-only events list |

`manage_X` implies view access — no separate `view_X` permission needed if `manage_X` is held.

### Default positions (auto-populated on tournament create)
| Position key | Label | Default permissions |
|---|---|---|
| `tournament_director` | Tournament Director | `["manage_tournament"]` |
| `volunteer_coordinator` | Volunteer Coordinator | `["manage_volunteers"]` |
| `test_coordinator` | Test Coordinator | `["manage_events"]` |
| `materials_coordinator` | Materials Coordinator | `["manage_materials"]` |
| `logistics` | Director of Logistics | `["manage_logistics"]` |
| `lead_event_supervisor` | Lead Event Supervisor | `["view_events"]` |
| `event_supervisor` | Event Supervisor | `["view_events"]` |
| `runner` | Runner | `["view_events"]` |
| `scoring` | Scoring | `["view_events"]` |
| `scoremaster` | Scoremaster | `["view_events"]` |
| `arbitrations` | Arbitrations | `["view_events"]` |
| `awards` | Awards | `["view_events"]` |
| `test_writer` | Test Writer | `["view_events"]` |
| `test_reviewer` | Test Reviewer | `["view_events"]` |

TDs can add/edit/remove positions for their tournament at any time via `PATCH /tournaments/{id}/`. The `DEFAULT_POSITIONS` list in `permissions.py` is the canonical source — edit there to change defaults globally.

---

## Database Models (all active)

### Tournament
```python
id, name
start_date (DateTime, nullable)
end_date (DateTime, nullable)
location (nullable)
blocks: JSON           # [{number, label, date, start, end}, ...]
volunteer_schema: JSON # {custom_fields: [...], positions: [{key, label, permissions}, ...]}
owner_id (FK→users)    # user who created the tournament — always has tournament_director membership
created_at, updated_at
# relationships: sheet_configs, events, memberships (all cascade delete)
```

### SheetConfig
```python
id, tournament_id (FK→tournaments CASCADE)
label, sheet_type (interest|confirmation|events)
sheet_url, spreadsheet_id, sheet_name
column_mappings: JSON   # {header: {field, type, row_key?, extra_key?}}
is_active (bool)
last_synced_at (DateTime, nullable)
created_at, updated_at
UNIQUE: (tournament_id, sheet_type)
```

### Event
```python
id, tournament_id (FK→tournaments CASCADE)
name, division (B|C), event_type (standard|trial)
category, building, room, floor
volunteers_needed (default 2)
blocks: JSON   # [14,15,16,...] — block numbers this event runs
created_at, updated_at
UNIQUE: (tournament_id, name, division)
```

### User
```python
id
first_name, last_name (nullable)
email (unique, indexed)
phone, shirt_size, dietary_restriction (all nullable)
university, major, employer (all nullable)
hashed_password (nullable)
role: string               # "admin" | "user"
is_active: bool
created_at, updated_at
```

### Membership
```python
id
user_id (FK→users CASCADE)
tournament_id (FK→tournaments CASCADE)
assigned_event_id (FK→events SET NULL, nullable)
positions: JSON    # list of position keys e.g. ["lead_event_supervisor", "test_writer"]
schedule: JSON     # [{block: int, duty: str}, ...]
status: string     # "interested"|"confirmed"|"declined"|"assigned"|"removed"
role_preference: JSON    # ["event_volunteer", "general_volunteer"]
event_preference: JSON   # ["Boomilever", "Hovercraft"]
availability: JSON       # [{date, start, end}, ...]
lunch_order, notes (nullable)
extra_data: JSON         # all tournament-specific arbitrary data
                         # e.g. {"transportation": "Driving", "general_volunteer_interest": ["STEM Expo"]}
created_at, updated_at
UNIQUE: (user_id, tournament_id)
```

---

## Key Design Decisions

### Membership-based permissions
- `User.role` is only `"admin"` or `"user"` — no `"td"` or `"volunteer"` on the User
- The same user can be TD of Tournament A and volunteer in Tournament B simultaneously
- `Membership.positions` is the source of truth for both title and access level within a tournament
- `admin` role bypasses all tournament checks — for platform management and testing only
- Creating a tournament auto-creates a `tournament_director` membership for the creator

### Route nesting
Events, memberships, and sheets are nested under `/tournaments/{tournament_id}/`:
- `tournament_id` is always in the path → clean permission checks without object lookups
- `tournament_id` in the URL is validated against `tournament_id` in the request body (400 if mismatch)
- No `/api/v1` prefix — routes are bare: `/tournaments/`, `/auth/login/`, etc.
- All routes have trailing slashes

### PATCH merge behavior
- `SheetConfig.column_mappings` — **merges**
- `Membership.extra_data` — **merges**
- `Membership.availability` — **replaces**
- All scalar fields — replace on PATCH

### Tournament access pattern
- Non-members get **404** (not 403) on read routes — don't leak that a tournament exists
- Non-members get **403** on write routes — permission check fires before existence check
- `admin` always gets access regardless of membership

### Email as join key
When syncing sheets, if user with that email exists → update. If not → create.

---

## column_mappings — Rich ColumnMapping Structure

**7 mapping types:**
| Type | Description |
|---|---|
| `string` | Store value as-is |
| `ignore` | Skip this column |
| `boolean` | "Yes"/"No" → true/false |
| `integer` | Parse to int |
| `multi_select` | Comma-separated → JSON array |
| `matrix_row` | One row of availability grid → merged into availability JSON. Requires `row_key` |
| `category_events` | Grouped event category string → list of specific event names |

**KNOWN_FIELDS** (in `schemas/sheet_config.py`):
`__ignore__`, `first_name`, `last_name`, `email`, `phone`, `shirt_size`, `dietary_restriction`, `university`, `major`, `employer`, `role_preference`, `event_preference`, `availability`, `lunch_order`, `notes`, `extra_data`

Note: `general_volunteer_interest` was removed from KNOWN_FIELDS. Columns matching "general volunteer" now auto-suggest `field="extra_data"` with `extra_key="general_volunteer_interest"`.

---

## API Endpoints

All routes require `X-API-Key` header (skipped in dev when `API_KEY` is blank).
No `/api/v1` prefix — all routes are bare paths with trailing slashes.

```
GET    /health

# Auth
POST   /auth/login/
POST   /auth/logout/
GET    /auth/me/
POST   /auth/register/                                     # admin only — always creates role="user"

# Tournaments
GET    /tournaments/                                        # admin only — all tournaments
GET    /tournaments/me/                                     # authenticated — tournaments with any membership
POST   /tournaments/                                        # authenticated — auto-creates tournament_director membership
GET    /tournaments/{id}/                                   # any member
PATCH  /tournaments/{id}/                                   # manage_tournament
DELETE /tournaments/{id}/                                   # owner or admin only

# Events (nested under tournament)
GET    /tournaments/{id}/events/                            # view_events
GET    /tournaments/{id}/events/{event_id}/                 # view_events
POST   /tournaments/{id}/events/                            # manage_events or manage_tournament
PATCH  /tournaments/{id}/events/{event_id}/                 # manage_events or manage_tournament
DELETE /tournaments/{id}/events/{event_id}/                 # manage_events or manage_tournament

# Memberships (nested under tournament)
GET    /tournaments/{id}/memberships/                       # view_volunteers or manage_volunteers or manage_tournament
GET    /tournaments/{id}/memberships/{membership_id}/       # view_volunteers or manage_volunteers or manage_tournament
POST   /tournaments/{id}/memberships/                       # manage_volunteers or manage_tournament
PATCH  /tournaments/{id}/memberships/{membership_id}/       # manage_volunteers or manage_tournament
DELETE /tournaments/{id}/memberships/{membership_id}/       # manage_volunteers or manage_tournament

# Users (global — admin only)
GET    /users/
POST   /users/
GET    /users/{id}/
GET    /users/by-email/{email}/
PATCH  /users/{id}/
DELETE /users/{id}/

# Tournament-scoped user lookup
GET    /tournaments/{id}/users/{user_id}/                   # manage_volunteers or manage_tournament

# Sheets (nested under tournament — all require manage_tournament)
POST   /tournaments/{id}/sheets/validate/
POST   /tournaments/{id}/sheets/headers/
GET    /tournaments/{id}/sheets/configs/
POST   /tournaments/{id}/sheets/configs/
GET    /tournaments/{id}/sheets/configs/{config_id}/
PATCH  /tournaments/{id}/sheets/configs/{config_id}/
DELETE /tournaments/{id}/sheets/configs/{config_id}/
POST   /tournaments/{id}/sheets/configs/{config_id}/sync/
```

---

## Test Infrastructure

**conftest.py key fixtures:**
- `db` — in-memory SQLite with foreign keys ON, transaction rollback after each test
- `mock_sheets_service` — MagicMock(spec=SheetsService)
- `client` — TestClient with get_db, get_sheets_service overrides
- `admin_user` — role="admin"
- `td_user` — role="user", tournament_director membership in `td_tournament`
- `other_user` — role="user", tournament_director membership in `other_tournament`
- `td_tournament` — tournament owned by td_user, default positions in volunteer_schema
- `other_tournament` — tournament owned by other_user, td_user has no membership here
- `login(client, email, password)` — helper function, posts to `/auth/login/`

**Important test patterns:**
- User creation in tests: use `db` fixture directly — `POST /users/` is admin-only
- Sync test user verification: use `db.query(User)` directly — `GET /users/by-email/` is admin-only
- Non-members on write routes → 403 (permission check fires first)
- Non-members on read routes → 404 (don't leak existence)

---

## Sync Service (`app/services/sync_service.py`)

**Endpoint:** `POST /tournaments/{id}/sheets/configs/{config_id}/sync/`

**Logic per row:**
1. Parse all columns by `ColumnMapping` type
2. Upsert User by email
3. Upsert Membership by (user_id, tournament_id)
4. Merge availability slots — contiguous slots on same date merged
5. Merge extra_data into existing blob
6. Update `SheetConfig.last_synced_at`
7. Return `SyncResult`

**Note:** Synced memberships do not get `positions` set — they start as `positions=None` (no system permissions). TDs assign positions manually after sync.

---

## Development Phases

- [x] **Phase 1** — Tournament model: start/end date, blocks JSON, volunteer_schema JSON, PATCH endpoint
- [x] **Phase 1 patch** — Added `date` field to `TournamentBlock`
- [x] **Phase 2** — Event model: CRUD, division B/C, standard/trial, blocks, category, cascade delete
- [x] **Phase 3** — User + Membership models, schemas, routes, tests
- [x] **Phase 3 patch** — Membership PATCH merges `extra_data`
- [x] **Phase 4** — Rich `ColumnMapping` structure with type metadata
- [x] **Phase 5** — Sync service: full sheet upsert, availability parsing + merging
- [x] **Phase 5 patch** — Added `university`, `major`, `employer` to User
- [x] **Phase 6** — Deploy backend with API key auth, Alembic, Railway + PostgreSQL
- [x] **Phase 7 — Frontend**
  - [x] **7a** — Scaffold + design system (fonts, tokens, Button, Input, Card, Badge, api.ts)
  - [x] **7b** — Landing page (hero, grid bg, scroll animation, login form)
  - [x] **7c** — Auth wiring (JWT cookie, middleware, useAuth, dashboard stub)
  - [x] **7d** — App shell (tournament list page, sidebar, topbar, routing restructure to /dashboard/[tournamentId]/*)
  - [ ] **7e** — Tournament settings (blocks editor, sheet config wizard, sync)
  - [ ] **7f** — Events + volunteers tables
  - [ ] **7g** — Assignment dashboard
- [x] **Phase 8 — Architecture: membership-based permissions**
  - Replace `User.role` (admin|td|volunteer) with `User.role` (admin|user)
  - Add `Membership.positions` (replaces `roles` column) — drives title + permissions
  - Add `Membership.schedule` — day-of block assignments `[{block, duty}]`
  - Remove `Membership.general_volunteer_interest` — now lives in `extra_data`
  - Add `app/core/permissions.py` — permission constants, DEFAULT_POSITIONS, dependency factories
  - Nest events, memberships, sheets routes under `/tournaments/{id}/`
  - Remove `/api/v1` prefix, add trailing slashes to all routes
  - API key now required on all routes including auth
  - `POST /tournaments/` auto-creates `tournament_director` membership + populates `DEFAULT_POSITIONS`
  - `GET /tournaments/` admin-only; `GET /tournaments/me/` returns user's memberships
  - `DELETE /tournaments/{id}/` restricted to owner or admin
  - Alembic migration: drop `roles` + `general_volunteer_interest`, add `positions` + `schedule`, migrate user roles
  - Frontend `api.ts` updated: all routes, types, `tournamentsApi.list()` → `GET /tournaments/me/`
  - Cookie fix for preview environment (`APP_ENV=preview` → `domain=None`, `samesite=none`, `secure=True`)
  - CORS updated: `allow_origin_regex` covers all `nexus-*.ethanshih.vercel.app` preview URLs
- [x] **Phase 9 — Preview environments**
  - Railway preview environment (`nexus-preview.up.railway.app`) with separate PostgreSQL
  - Prod DB copied to preview via `pg_dump | psql` using public Railway URLs
  - Vercel preview auto-deploys every branch push; `API_URL` + `API_KEY` set for Preview environment
  - GitHub branch ruleset on `main` — PRs required, force push blocked, branch deletion blocked

---

## Known Issues / Future Work
- `role_preference` stores full question text — needs option mapping to normalize values
- `event_preference` not parsing correctly in real data — needs investigation
- Some `extra_data` booleans store full sentence instead of true/false
- Full sheet sync on every run — "sync only new rows" is a future optimization
- Railway trial period ends — may migrate backend to Render

---

## Deployment

### Backend (Railway)
- Root directory: `backend`, start command via `Procfile`
- Database: Railway PostgreSQL, internal `DATABASE_URL`
- Migrations locally: `$env:DATABASE_URL="<public_url>"; python -m alembic upgrade head` (PowerShell)
- Secrets: `APP_ENV`, `API_KEY`, `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`
- Custom domain: `nexus-api.ethanshih.com`

### Frontend (Vercel)
- Root directory: `frontend`
- Server-side env vars: `API_URL`, `API_KEY` (not `NEXT_PUBLIC_*` — kept server-side via proxy route)
- Custom domain: `nexus.ethanshih.com`
- Every branch push auto-generates a preview deployment
- Must redeploy manually after adding/changing env vars

### Preview environment
- Railway preview service: `nexus-preview.up.railway.app`
- To refresh preview DB from prod: `pg_dump <PROD_PUBLIC_URL> | psql <PREVIEW_PUBLIC_URL>`
  - Drop existing tables first: `psql <PREVIEW_PUBLIC_URL> -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`
- Railway preview public DB URL: `postgresql://postgres:...@yamanote.proxy.rlwy.net:31907/railway`
- Railway prod public DB URL: `postgresql://postgres:...@interchange.proxy.rlwy.net:19714/railway`

### Cross-subdomain cookie notes
- Production: both domains share `.ethanshih.com` — `domain=".ethanshih.com"` enables cookie sharing
- Preview: frontend on `.vercel.app`, backend on `.railway.app` — proxy handles everything server-side, `domain=None` works
- `credentials: 'include'` must be set on all fetch calls in `api.ts`
- Next.js middleware reads the cookie server-side to protect `/dashboard` routes

---

## Frontend Design System

### Fonts
- **`--font-serif`** → Instrument Serif — h1, h2, page titles, big numbers, wordmarks
- **`--font-sans`** → DM Sans — UI labels, buttons, nav labels, subheadings, badges
- **`--font-mono`** → DM Mono — body text, inputs, data values, emails, dates, code

### Colors (CSS variables)
- `--color-bg`: `#F7F7F5` | `--color-surface`: `#FFFFFF`
- `--color-accent`: `#0A0A0A` | `--color-accent-hover`: `#2A2A2A` | `--color-accent-subtle`: `#F0F0EC`
- `--color-danger`: `#E53E3E` | `--color-success`: `#22C55E` | `--color-warning`: `#EAB308`
- `--color-border`: `#E2E2DE` | `--color-border-strong`: `#C8C8C2`
- `--color-text-primary`: `#0A0A0A` | `--color-text-secondary`: `#6B6B65` | `--color-text-tertiary`: `#9B9B93`

### Components (`components/ui/`)
- `Button` — variants: primary (black), secondary, ghost, danger. Sizes: sm/md/lg. Loading spinner.
- `Input` — DM Sans label, 44px height, 16px left padding, error state
- `Card` — surface container with optional hover state
- `Badge` — status tags: interested, confirmed, declined, assigned, removed, admin, user

---

## Dashboard Design & UX

### Overall Aesthetic
Sleek, clean, black and white, techy — futuristic modern dashboard / control panel feel. Every surface should feel intentional and dense with information without being cluttered.

### Landing Page (`/`)
- Simple hero section (NEXUS wordmark + tagline)
- Login form appears on scroll
- No tournament data is public — user must log in to access their tournaments
- Implemented in Phase 7b/7c

### /dashboard — Tournament List
- No sidebar. Own topbar: NEXUS wordmark (left), user avatar/logout (right).
- Card grid of all tournaments the user has any membership in (calls `GET /tournaments/me/`)
- Each card shows: name, location, date range, event count, volunteer count (fetched in parallel after list loads)
- "Add Tournament" button → modal → navigates to `/dashboard/[id]/overview` on create
- Clicking a card navigates to `/dashboard/[id]/overview`

### /dashboard/[tournamentId] — Tournament Shell
- **Sidebar** — sticky, in normal flow (expanding pushes content right, no overlay)
  - Collapsed: 52px wide, icons only
  - Expanded: 192px wide, icons + DM Sans labels
  - Icons: Overview (house), Assignments, Events, Volunteers, Settings (gear)
  - NEXUS/NX wordmark at top links back to `/dashboard`
  - Expand/collapse toggle pinned to bottom
- **Topbar** — sticky, tournament selector dropdown (280px, navigates preserving current segment), user avatar/logout
- **Main content** — 12px top / 14px left padding, no fixed positioning offsets
- **URL param drives selected tournament** — navigating directly to `/dashboard/2/overview` always loads tournament 2 via `tournamentsApi.get(id)`

### /dashboard/[tournamentId]/overview
- Blank for now — placeholder for tournament summary/stats

### /dashboard/[tournamentId]/assignments (Phase 7g)
The primary assignment view. Single page, dynamic, no full reloads — everything via panels and modals.

**Layout:**
- **Center** — rows of events, one per event. Each row shows event name, division, block(s), volunteers needed, currently assigned volunteers
- **Day tabs** — if tournament has multiple days, tabs at the top to switch (Thu / Fri / Sat). Each tab filters events by the blocks running that day
- **Right collapsible panel** — volunteer cards, scrollable list. Panel can be collapsed to give more horizontal space to event rows

**Volunteer cards (right panel):**
- Volunteer name (prominent)
- Tags for event preferences
- Tags for expertise/experience
- Availability indicator (available for current day/block being viewed)
- Cards are draggable — drag onto an event row to assign
- Once assigned, card disappears from right panel and appears in the event row

**Event rows (center):**
- Event name + division badge (B/C)
- Block number(s) it runs
- Volunteer slots — empty slots shown as placeholders, filled slots show assigned volunteer name
- Click event row → side panel or modal with full event details + all assigned volunteers

### /dashboard/[tournamentId]/events (Phase 7f)
- Table view of all events for the selected tournament
- Columns: name, division, category, building/room, blocks, volunteers needed, assigned count
- Sortable, filterable
- Click row → edit event modal

### /dashboard/[tournamentId]/volunteers (Phase 7f)
- Table view of all volunteers (memberships) for the selected tournament
- Columns: name, email, status badge, role preference, availability summary, assigned event
- Sortable, filterable by status
- Click row → volunteer detail side panel

### /dashboard/[tournamentId]/settings (Phase 7e)
Where the TD configures a tournament before using the assignment dashboard.

**Steps:**
1. **Basic info** — name, location, start date, end date
2. **Time blocks** — TD defines blocks (number, label, date, start time, end time)
3. **Sheet config wizard** — connect Google Sheets:
   - Enter sheet URL → validate
   - Select sheet name → fetch headers
   - Review suggested column mappings — all headers displayed with their mapped field, type, and any extra config
   - All mapping fields are editable inline
   - Save → calls `POST /tournaments/{id}/sheets/configs/`
4. **Sync** — once config is saved, TD can trigger a sync to pull volunteer data

---

## Sync Service (`app/services/sync_service.py`)

**Endpoint:** `POST /tournaments/{id}/sheets/configs/{config_id}/sync/`

**Logic per row:**
1. Parse all columns by `ColumnMapping` type
2. Upsert User by email
3. Upsert Membership by (user_id, tournament_id)
4. Merge availability slots — contiguous slots on same date merged
5. Merge extra_data into existing blob
6. Update `SheetConfig.last_synced_at`
7. Return `SyncResult`

---

## Real Tournament Reference — 2026 Nationals @ USC
**Dates:** May 21–23, 2026

**Interest form headers (exact, with spacing):**
- `Timestamp`
- `Email Address`
- `First Name` / `Last Name`
- `Phone Number (###) ###-#### ` ← trailing space
- `Please verify your age on the day you are signing up to volunteer on.  ` ← two trailing spaces
- `If you are a college student, what year are you in?`
- `Current employer or university:`
- `How will you get to the Nationals Tournament @ USC?`
- `Which area will you be coming from?`
- `Do you have any potential conflict of interests? (N/A if none)`
- `Have you competed in Science Olympiad in the past?`
- `If you have competed in the past, please list what events you competed in and what schools you represented? ` ← trailing space
- `Have you volunteered for past Science Olympiad competitions?`
- `If you have volunteered in the past, please describe your experience. Do you have any specific expertise or interests? ` ← trailing space
- `Volunteering Role Preference`
- `Availability from 5/21 to 5/23 [8:00 AM  - 10:00 AM]` ← double space before dash
- `Availability from 5/21 to 5/23 [10:00 AM  -  NOON]` ← double spaces around dash
- `Availability from 5/21 to 5/23 [NOON - 2:00 PM]`
- `Availability from 5/21 to 5/23 [2:00 PM - 4:00 PM]`
- `Availability from 5/21 to 5/23 [4:00 PM - 6:00 PM]`
- `Availability from 5/21 to 5/23 [6:00 PM - 8:00 PM]`
- `If interested in event volunteering, which event(s) would you prefer helping with?`
- `If you are interested in general volunteer, which activities would you be interested in helping with?`
- `Are there any limitations we should know about to better support your volunteer experience? (Ex. can't carry heavy objects, limited mobility, etc.)`
- `How many people can you take?`
- `How did you hear about us?`
