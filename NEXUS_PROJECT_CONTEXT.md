# NEXUS — Science Olympiad Tournament Manager
## Project Context Document
*Last updated: issue-4-membership-list-inline-user*

> **Stylization:** The product name is always written **NEXUS** (all caps) in UI copy, docs, and design contexts. Use lowercase `nexus` only where required by code or URLs (e.g. repo name, route paths, package names).

> **API version:** `0.2.0`

---

## Overview
Full-stack web dashboard for Science Olympiad tournament directors to manage volunteer logistics, event assignments, and tournament data. Data flows: **Google Forms → Google Sheets → NEXUS**.

- **Project name:** NEXUS
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
    │   ├── globals.css                # Design tokens, Geist Sans + Geist Mono + Georgia
    │   ├── layout.tsx                 # Root layout
    │   ├── page.tsx                   # Landing page + login form
    │   └── dashboard/
    │       ├── layout.tsx             # AuthProvider only — no chrome
    │       ├── page.tsx               # Tournament card grid, uses unified Topbar (showWordmark showAvatar)
    │       └── [tournamentId]/
    │           ├── layout.tsx         # TournamentProvider + Sidebar + Topbar (showDropdown showAvatar) + main
    │           ├── overview/page.tsx  # Blank for now
    │           ├── assignments/page.tsx
    │           ├── events/page.tsx
    │           ├── volunteers/page.tsx # Temp volunteer table — user data inline (no per-row fetches), search, status filter, sortable columns
    │           ├── settings/page.tsx
    │           └── sheets/
    │               ├── page.tsx       # Sheets index — clickable config cards, export, sync, duplicate tab warnings
    │               ├── new/
    │               │   └── page.tsx   # Add Sheet wizard (4 steps: URL → select → mapping → results)
    │               └── [configId]/
    │                   ├── page.tsx   # View sheet config — read-only mapping table, edit button, danger zone
    │                   └── edit/
    │                       └── page.tsx # Edit sheet config — live header diff, import/export, save & sync
    ├── components/
    │   ├── ui/
    │   │   ├── Button.tsx             # primary/secondary/ghost/danger, built-in hover state, interactive prop
    │   │   ├── Input.tsx              # label, error, helper, 16px left padding
    │   │   ├── Card.tsx               # surface container
    │   │   ├── Badge.tsx              # status badges (confirmed, declined, assigned, etc.)
    │   │   ├── Icons.tsx              # ALL shared SVG icons — import from here, never define inline
    │   │   ├── Modal.tsx              # base modal wrapper with backdrop, Escape-to-close, title slot
    │   │   ├── NewTournamentModal.tsx # tournament creation form modal — used in Topbar and dashboard/page
    │   │   ├── FieldLabel.tsx         # uppercase 11px form field label
    │   │   ├── PageHeader.tsx         # title + subtitle + optional action button
    │   │   ├── StepIndicator.tsx      # wizard step bar, accepts any steps array
    │   │   ├── RadioOption.tsx        # styled radio card with border highlight
    │   │   ├── StatCard.tsx           # big number + label card (sync results, future stats)
    │   │   ├── EmptyState.tsx         # centered empty state with icon, title, description, action
    │   │   ├── UserAvatar.tsx         # avatar button + name/email/role dropdown + sign out
    │   │   ├── SplitButton.tsx        # primary action + chevron dropdown, per-half hover, variants + sizes
    │   │   ├── Banner.tsx             # inline feedback banner, variants: success/error/warning/info, optional action + dismiss
    │   │   └── ImportSummaryModal.tsx # modal showing full import diff: updated (from/to), unchanged, notInFile, notInSheet
    │   └── layout/
    │       ├── Sidebar.tsx            # Sticky, in normal flow, expandable 52px→192px, tournamentId prop
    │       └── Topbar.tsx             # Unified topbar — showWordmark, showDropdown, showAvatar props
    │                                  # showDropdown renders TournamentDropdown (isolated so useTournament
    │                                  # only called when TournamentProvider is in tree)
    ├── lib/
    │   ├── api.ts                     # ApiError, authApi, tournamentsApi, eventsApi, usersApi, membershipsApi, sheetsApi + full types
    │   │                              # membershipsApi.deleteMembershipsByEmails — TEMP: serial deletes, tracked in GitHub issue
    │   │                              # sheetsApi.getEmailsForNuclearDelete — TEMP: fetches all memberships, tracked in GitHub issue
    │   ├── importMappings.ts          # MappingRow, MappingsExport, ImportSummary types + parseMappingsJson, parseMappingsCsv, applyImport
    │   ├── useAuth.tsx                # AuthProvider + useAuth hook
    │   └── useTournament.tsx          # TournamentProvider + useTournament hook, persists selection to localStorage
    ├── middleware.ts                  # Protect /dashboard/*, redirect if logged in on /
    │                                  # NOTE: exported as `proxy` (not `middleware`) per Vercel deprecation
    ├── tailwind.config.ts             # fontFamily: sans=Geist, mono=Geist Mono, serif=Georgia
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
owner_id (FK→users)
created_at, updated_at
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
UNIQUE: (tournament_id, sheet_type)   # ← tracked for removal, see Known Issues
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
- Events, memberships, and sheets are nested under `/tournaments/{tournament_id}/`
- `tournament_id` in the URL is validated against `tournament_id` in the request body (400 if mismatch)
- No `/api/v1` prefix — routes are bare: `/tournaments/`, `/auth/login/`, etc.
- All routes have trailing slashes

### PATCH merge behavior
- `SheetConfig.column_mappings` — **merges**
- `Membership.extra_data` — **merges**
- `Membership.availability` — **replaces**
- All scalar fields — replace on PATCH

### Tournament access pattern
- Non-members get **404** (not 403) on read routes
- Non-members get **403** on write routes
- `admin` always gets access regardless of membership

### Duplicate sheet tab handling
- Multiple `SheetConfig`s pointing at the same `(spreadsheet_id, sheet_name)` within a tournament are **allowed**.
- The upsert-by-email sync logic is safe: no data corruption, last sync wins per field.
- **UX guards (frontend-only, no DB constraint):**
  - **Sheets index page:** cards with a duplicate tab get a yellow ⚠ warning banner and yellow card border.
  - **Add Sheet wizard (step 2):** inline warning banner if the selected tab is already connected.
  - **Sync confirmation dialog:** required on sync (index page) and Save & Sync (wizard) when duplicates exist.
  - **Edit page:** same duplicate warning shown on the tab selection section.

### Sheet config export/import
- Export formats: JSON (full `column_mappings` object + label/sheet_type/sheet_name) and CSV (flat table: header, field, type, row_key, extra_key)
- Import is non-destructive: only updates rows whose header name matches; unmatched rows keep current values
- Import feedback uses `Banner` + `ImportSummaryModal` (shows per-row diff: updated from/to, unchanged count, headers not in file, headers not in sheet)
- Import/export logic lives in `frontend/lib/importMappings.ts` — shared between wizard and edit page

### Membership list serialization (issue #4)
- `GET /tournaments/{id}/memberships/` returns `MembershipReadWithUser` — user name/email embedded inline
- Backend uses `joinedload(Membership.user)` for a single JOIN query instead of N lazy loads
- The list endpoint returns ORM objects directly (not via `_serialize`) so Pydantic can walk the nested `user` relationship via `from_attributes=True`. Returning a plain `dict` breaks nested ORM serialization in FastAPI.
- All other endpoints (get, create, update, delete) still use `_serialize()` and return `MembershipRead`
- Frontend `volunteers/page.tsx` reads `m.user` directly off each membership — no `usersApi` calls

### Frontend component conventions
- **Always use `Button`** — never inline button elements for actions
- **Always use `SplitButton`** for export/import actions that have a primary + dropdown variant (JSON primary, CSV in dropdown)
- **Always use `Banner`** for inline import feedback — replaces old inline toast pattern
- **Always use `ImportSummaryModal`** for showing detailed import diff
- **Always use `PageHeader`** for page title + subtitle + action
- **Always use `EmptyState`** for empty list states
- **All SVG icons in `components/ui/Icons.tsx`** — never define icons inline
- **`Modal` + specific modal components** — base `Modal.tsx` wraps content
- **`Topbar` is unified** — use `showWordmark` for dashboard, `showDropdown` for tournament pages

### Fonts
- `--font-serif`: Georgia — h1, h2, page titles, big numbers, wordmarks
- `--font-sans`: Geist — UI labels, buttons, nav, badges
- `--font-mono`: Geist Mono — body text, inputs, data values

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

**KNOWN_FIELDS:** `__ignore__`, `first_name`, `last_name`, `email`, `phone`, `shirt_size`, `dietary_restriction`, `university`, `major`, `employer`, `role_preference`, `event_preference`, `availability`, `lunch_order`, `notes`, `extra_data`

---

## API Endpoints

```
GET    /health

# Auth
POST   /auth/login/
POST   /auth/logout/
GET    /auth/me/
POST   /auth/register/                                     # admin only

# Tournaments
GET    /tournaments/                                        # admin only
GET    /tournaments/me/                                     # authenticated
POST   /tournaments/                                        # authenticated
GET    /tournaments/{id}/                                   # any member
PATCH  /tournaments/{id}/                                   # manage_tournament
DELETE /tournaments/{id}/                                   # owner or admin only

# Events
GET    /tournaments/{id}/events/                            # view_events
GET    /tournaments/{id}/events/{event_id}/                 # view_events
POST   /tournaments/{id}/events/                            # manage_events or manage_tournament
PATCH  /tournaments/{id}/events/{event_id}/                 # manage_events or manage_tournament
DELETE /tournaments/{id}/events/{event_id}/                 # manage_events or manage_tournament

# Memberships
GET    /tournaments/{id}/memberships/                       # view_volunteers+ — returns MembershipReadWithUser (user inline)
GET    /tournaments/{id}/memberships/{membership_id}/       # view_volunteers+
POST   /tournaments/{id}/memberships/                       # manage_volunteers+
PATCH  /tournaments/{id}/memberships/{membership_id}/       # manage_volunteers+
DELETE /tournaments/{id}/memberships/{membership_id}/       # manage_volunteers+

# Users (admin only)
GET    /users/
POST   /users/
GET    /users/{id}/
GET    /users/by-email/{email}/
PATCH  /users/{id}/
DELETE /users/{id}/
GET    /tournaments/{id}/users/{user_id}/                   # manage_volunteers or manage_tournament

# Sheets
POST   /tournaments/{id}/sheets/validate/                  # manage_tournament
POST   /tournaments/{id}/sheets/headers/                   # manage_tournament
GET    /tournaments/{id}/sheets/configs/                   # manage_tournament
POST   /tournaments/{id}/sheets/configs/                   # manage_tournament
GET    /tournaments/{id}/sheets/configs/{config_id}/       # manage_tournament
PATCH  /tournaments/{id}/sheets/configs/{config_id}/       # manage_tournament
DELETE /tournaments/{id}/sheets/configs/{config_id}/       # manage_tournament
POST   /tournaments/{id}/sheets/configs/{config_id}/sync/  # manage_tournament

# Planned (not yet built — tracked in GitHub issues)
POST   /tournaments/{id}/memberships/delete-by-emails/     # bulk delete by email list
GET    /tournaments/{id}/sheets/configs/{config_id}/rows/  # proxy sheet rows to frontend
```

---

## Test Infrastructure

**conftest.py key fixtures:**
- `db` — in-memory SQLite with foreign keys ON, transaction rollback after each test
- `mock_sheets_service` — MagicMock(spec=SheetsService)
- `client` — TestClient with get_db, get_sheets_service overrides
- `admin_user`, `td_user`, `other_user`, `td_tournament`, `other_tournament`
- `login(client, email, password)` — helper function

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
  - [x] **7e** — Sheets UI + frontend refactor (merged + tested ✓)
  - [ ] **7f** — Events + volunteers tables (proper, not temp)
  - [ ] **7g** — Assignment dashboard
- [x] **Phase 8 — Architecture: membership-based permissions**
- [x] **Phase 9 — Preview environments**
- [x] **Issue #4 — Membership list inline user data** (merged to staging)

### Phase 7e — Sheets UI + Frontend Refactor ✓

**Completed and tested:**
- Sheets index page (`/dashboard/[id]/sheets`) — clickable cards → view page, 3-dot menu (export JSON/CSV, edit, delete with confirm modal), sync button, duplicate tab warning banners + sync confirm modal
- Add Sheet wizard (`/dashboard/[id]/sheets/new`) — 4-step flow: URL → sheet select → column mapping → save+sync → results
  - Import JSON/CSV via SplitButton with Banner feedback and ImportSummaryModal
- View sheet config page (`/dashboard/[id]/sheets/[configId]`) — read-only page:
  - Metadata row: type, sheet tab, status, last synced — 4 equal sections in one bordered row
  - Read-only mapping table: same 4-column grid as edit page (Sheet Column / Field / Type / Extra Key), column headers wrap, rows vertically centered, ignored rows dimmed
  - Edit button (top right) navigates to edit page
  - Danger zone: delete config, nuclear delete (deletes config + all memberships in tournament)
- Edit sheet config page (`/dashboard/[id]/sheets/[configId]/edit`):
  - Loads live headers from Google (re-fetches on tab change via AbortController)
  - Row state diff: same (no highlight) · changed (amber) · new (green) · removed (red, locked)
  - Summary counts: unchanged · edited · new · removed
  - Import JSON/CSV with Banner + ImportSummaryModal, respects row state
  - Export JSON/CSV via SplitButton
  - Save (PATCH only) and Save & Sync
  - Back/Cancel both return to view page
  - Danger zone removed (lives on view page only)
- Volunteers page (`/dashboard/[id]/volunteers`) — temporary table view:
  - User name/email now loaded inline (no per-row API calls) — fixed via issue #4
  - Columns: name, email, status, role preference, event preference, availability slot count
  - Auto-detects up to 4 `extra_data` keys across memberships
  - Search by name/email, status filter, sortable columns
- Shared component library additions: `SplitButton`, `Banner`, `ImportSummaryModal`
- Icons added: `IconEdit`, `IconTrash`, `IconDotsVertical`, `IconExport`
- Shared utility library: `frontend/lib/importMappings.ts` (parse + apply import, types)
- `api.ts` additions: `membershipsApi.deleteMembershipsByEmails` (temp), `sheetsApi.getEmailsForNuclearDelete` (temp), `sheetsApi.getConfig`, `sheetsApi.updateConfig`
- UTC datetime normalization: `fmtDateTime` appends `Z` if no timezone suffix (temp fix)

**File locations:**
- `sheets/page.tsx` — index
- `sheets/new/page.tsx` — wizard
- `sheets/[configId]/page.tsx` — view config
- `sheets/[configId]/edit/page.tsx` — edit config

### Issue #4 — Membership list inline user data ✓

**Problem:** `GET /tournaments/{id}/memberships/` returned memberships without user info. The volunteers page was making a separate `usersApi.getForTournament` call per membership (O(n) requests), causing rate limiting as the volunteer list grew.

**Backend fix (`backend/app/api/routes/memberships.py`):**
- Added `joinedload(Membership.user)` to the list query
- Switched `GET /` `response_model` to `MembershipReadWithUser`
- List endpoint returns ORM objects directly (not via `_serialize`) — returning a plain `dict` breaks `from_attributes` on nested ORM objects in FastAPI; Pydantic can only apply `from_attributes` when the top-level response is an ORM object
- All other endpoints unchanged

**Frontend fix (`frontend/app/dashboard/[tournamentId]/volunteers/page.tsx`):**
- Removed `Promise.all(ms.map(async (m) => usersApi.getForTournament(...)))` fan-out
- Reads `m.user` directly off the membership response
- Removed `usersApi` import

---

## Branch Strategy & Issue Tracking

### Branch separation — backend vs frontend
Backend and frontend changes are developed on **separate feature branches** and PRed independently. This is required because the Railway preview environment is only connected to `staging` — backend changes need to be live on `staging` before frontend changes that depend on them can be tested end-to-end.

```
feature/backend-*   →  staging  →  main   (backend changes)
feature/frontend-*  →  staging  →  main   (frontend changes)
```

Never mix backend and frontend changes in the same branch unless they are trivially coupled and both safe to ship together.

### Backend issues found during frontend work
When a backend bug or missing feature is discovered while working on the frontend:
1. **Document it in this context doc** under Known Issues / Future Work with enough detail to fix it later (error message, file, line, suggested fix).
2. **Open a GitHub issue** so it's tracked and doesn't get lost between sessions.

Do not block frontend progress on backend fixes unless the frontend literally cannot function without them.

---

## Known Issues / Future Work
- `role_preference` stores full question text — needs option mapping to normalize values
- `event_preference` not parsing correctly in real data — needs investigation
- Some `extra_data` booleans store full sentence instead of true/false
- Full sheet sync on every run — "sync only new rows" is a future optimization
- Railway trial period ends — may migrate backend to Render
- **[GitHub issue opened] Remove `UNIQUE(tournament_id, sheet_type)` constraint from `sheet_configs`** — the constraint is too restrictive; `sheet_type` is display metadata, not a meaningful uniqueness boundary. A TD may legitimately want multiple configs with the same type but different column mappings. Currently triggers an unhandled 500 when violated. Fix: drop the constraint via a new Alembic migration and remove `UniqueConstraint("tournament_id", "sheet_type", ...)` from `app/models/models.py`. Duplicate-config UX is already handled entirely on the frontend via warning banners and confirmation dialogs. Labels: `backend` `database` `breaking-change`.
- **[GitHub issue opened] `DateTime` columns serialized without timezone info** — SQLAlchemy's `DateTime` (without `timezone=True`) strips timezone info when reading from the DB, so datetimes are serialized without a `Z` or `+00:00` suffix. The browser then interprets them as local time instead of UTC, causing incorrect display (e.g. `last_synced_at` showing the wrong time). **Temp fix:** `fmtDateTime` in `sheets/page.tsx` and `sheets/[configId]/page.tsx` appends `Z` if no timezone suffix is present. **Proper fix:** change all `DateTime` columns in `app/models/models.py` to `DateTime(timezone=True)`, write an Alembic migration, then remove the frontend normalization. Labels: `bug` `backend` `database` `breaking-change`.
- **[GitHub issue opened] Backend endpoints for bulk membership delete and raw sheet row fetch** — two temp implementations in `api.ts` need proper backend routes:
  - `membershipsApi.deleteMembershipsByEmails` — currently fetches all memberships + filters client-side + serial deletes (O(n) requests). Proper fix: `POST /tournaments/{id}/memberships/delete-by-emails/` with `{ emails: string[] }` → `{ deleted: number }`.
  - `sheetsApi.getEmailsForNuclearDelete` — currently fetches all memberships and extracts emails (does NOT cross-reference live sheet). Proper fix: `GET /tournaments/{id}/sheets/configs/{configId}/rows/` which proxies `sheets_service.get_rows()`. Labels: `enhancement` `backend` `performance`.
- **[GitHub issue opened] Add `sheet_config_ids` to Membership** — JSON list of config IDs that have synced into a membership, for provenance tracking. Labels: `enhancement` `backend` `database`.

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
- Server-side env vars: `API_URL`, `API_KEY`
- Custom domain: `nexus.ethanshih.com`
- Every branch push auto-generates a preview deployment

### Preview environment
- Railway preview service: `nexus-preview.up.railway.app`
- To refresh preview DB: drop schema + pg_dump prod into preview
- Railway preview public DB URL: `postgresql://postgres:...@yamanote.proxy.rlwy.net:31907/railway`
- Railway prod public DB URL: `postgresql://postgres:...@interchange.proxy.rlwy.net:19714/railway`

---

## Frontend Design System

### Fonts
- **`--font-serif`** → Georgia — h1, h2, page titles, big numbers, wordmarks
- **`--font-sans`** → Geist — UI labels, buttons, nav labels, subheadings, badges
- **`--font-mono`** → Geist Mono — body text, inputs, data values, emails, dates, code

### Colors (CSS variables)
- `--color-bg`: `#F7F7F5` | `--color-surface`: `#FFFFFF`
- `--color-accent`: `#0A0A0A` | `--color-accent-hover`: `#2A2A2A` | `--color-accent-subtle`: `#F0F0EC`
- `--color-danger`: `#E53E3E` | `--color-success`: `#22C55E` | `--color-warning`: `#EAB308`
- `--color-border`: `#E2E2DE` | `--color-border-strong`: `#C8C8C2`
- `--color-text-primary`: `#0A0A0A` | `--color-text-secondary`: `#6B6B65` | `--color-text-tertiary`: `#9B9B93`

### Component conventions
- `Button` — variants: primary (black), secondary, ghost, danger. Sizes: sm/md/lg. Built-in hover state via `interactive` prop (default true).
- `SplitButton` — primary action + chevron dropdown, per-half hover. Use for export (JSON primary, CSV dropdown) and import (JSON primary, CSV dropdown).
- `Banner` — inline feedback. Variants: success/error/warning/info. Optional `action` slot (e.g. "Show summary" button) and `onDismiss`. Use instead of toast for import feedback.
- `ImportSummaryModal` — detailed import diff modal. Shows updated rows (from/to), unchanged count, headers not in file, headers not in sheet.
- `Input` — Geist label, 44px height, 16px left padding, error state
- `Card` — surface container with optional hover state
- `Badge` — status tags: interested, confirmed, declined, assigned, removed, admin, user
- `PageHeader` — always use for page title + subtitle + action button
- `EmptyState` — always use for empty list states
- `Modal` — base wrapper; `NewTournamentModal` is the shared tournament creation form
- `StepIndicator` — wizard step bar, pass any `steps` array
- `RadioOption` — styled radio card with border highlight, `mono` prop for monospace label
- `StatCard` — big number + label, used for sync results and future dashboard stats
- `UserAvatar` — avatar + dropdown in `components/ui/`
- `Icons` — all SVG icons in `components/ui/Icons.tsx`, never define inline

### Dashboard design
- **`/dashboard`** — tournament card grid, `Topbar showWordmark showAvatar`
- **`/dashboard/[id]/*`** — sidebar + `Topbar showDropdown showAvatar`
- Sidebar: 52px collapsed / 192px expanded, in normal flow (pushes content, no overlay)
- All pages use `width: 100%` so they flex with sidebar expand/collapse

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
- `Are there any limitations we should know about to better support your volunteer experience?`
- `How many people can you take?`
- `How did you hear about us?`
