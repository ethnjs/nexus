# NEXUS — Science Olympiad Tournament Manager
## Project Context Document
*Last updated: feat/sheet-config-parse-rules-ux + feat/volunteers-display*

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
│   │   │   ├── sheet_config.py        # SheetConfig schemas + ColumnMapping + ParseRule + KNOWN_FIELDS + SyncResult
│   │   │   └── auth.py                # LoginRequest, RegisterRequest, UserResponse
│   │   ├── services/
│   │   │   ├── sheets_service.py      # Google Sheets API logic + header auto-detection
│   │   │   ├── sync_service.py        # Sync logic: upsert users/memberships from sheet rows, parse rules engine
│   │   │   └── validation.py          # validate_column_mappings() — ValidationIssue, ValidationResult
│   │   └── api/routes/
│   │       ├── auth.py                # Login, logout, me, register
│   │       ├── tournaments.py         # Tournament CRUD
│   │       ├── events.py              # Event CRUD — nested under /tournaments/{id}/events/
│   │       ├── users.py               # User CRUD (admin-only global) + GET /tournaments/{id}/users/{id}
│   │       ├── memberships.py         # Membership CRUD — nested under /tournaments/{id}/memberships/
│   │       └── sheets.py              # Sheet wizard + config CRUD + sync + 422 validation wiring
│   ├── alembic/                       # Alembic migrations
│   │   ├── env.py
│   │   ├── script.py.mako
│   │   └── versions/
│   │       ├── b079268fceb2_initial_schema_with_auth.py
│   │       ├── f4e526de3a94_add_auth_fields.py
│   │       └── a1b2c3d4e5f6_membership_positions_schedule_user_role.py
│   ├── tests/
│   │   ├── conftest.py
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
│   │       ├── test_sync_service.py
│   │       └── test_validation.py
│   ├── conftest.py
│   ├── alembic.ini
│   ├── Procfile
│   ├── pytest.ini
│   ├── requirements.txt
│   ├── .env
│   ├── .env.example
│   └── .gitignore
└── frontend/
    ├── app/
    │   ├── globals.css                # Design tokens, Geist Sans + Geist Mono + Georgia
    │   ├── layout.tsx
    │   ├── page.tsx                   # Landing page + login form
    │   └── dashboard/
    │       ├── layout.tsx
    │       ├── page.tsx               # Tournament card grid
    │       └── [tournamentId]/
    │           ├── layout.tsx
    │           ├── overview/page.tsx
    │           ├── assignments/page.tsx
    │           ├── events/page.tsx
    │           ├── volunteers/page.tsx # Volunteer table — inline user data, tags for multi-select fields, availability as stacked date+time rows, wider extra_data columns
    │           ├── settings/page.tsx
    │           └── sheets/
    │               ├── page.tsx       # Sheets index — cards, export JSON (3-dot menu), sync, duplicate tab warnings
    │               ├── new/
    │               │   └── page.tsx   # Add Sheet wizard — Import JSON button, parse rules wired
    │               └── [configId]/
    │                   ├── page.tsx   # View sheet config — read-only mapping table, Export JSON + Edit buttons, danger zone
    │                   └── edit/
    │                       └── page.tsx # Edit sheet config — Input + Select components for top fields, import JSON, save & sync
    ├── components/
    │   ├── ui/
    │   │   ├── Button.tsx             # primary/secondary/ghost/danger, sm/md/lg, loading, interactive prop
    │   │   ├── Input.tsx              # label, error, helper, font prop (sans/mono/serif), 44px height, surface background
    │   │   ├── Select.tsx             # Custom themed dropdown — keyboard nav, option groups, sm/md sizes, minWidth prop, fixed-position panel (avoids z-index/overflow clipping), stopPropagation on trigger
    │   │   ├── Card.tsx
    │   │   ├── Badge.tsx              # status badges: interested/confirmed/declined/assigned/removed
    │   │   ├── Icons.tsx              # ALL shared SVG icons — import from here, never define inline
    │   │   ├── Modal.tsx
    │   │   ├── NewTournamentModal.tsx
    │   │   ├── FieldLabel.tsx
    │   │   ├── PageHeader.tsx
    │   │   ├── StepIndicator.tsx
    │   │   ├── RadioOption.tsx
    │   │   ├── StatCard.tsx
    │   │   ├── EmptyState.tsx
    │   │   ├── UserAvatar.tsx
    │   │   ├── Banner.tsx             # inline feedback, variants: success/error/warning/info, optional action + dismiss
    │   │   ├── ImportSummaryModal.tsx # 720px wide; shows per-field diffs (red→green) and per-rule diffs in single boxes with rule number centered; unchanged rules dimmed; Parse Rules section label with "(unchanged)" when no rule changes
    │   │   └── SheetConfigMappingTable.tsx # See detailed notes below
    │   └── layout/
    │       ├── Sidebar.tsx
    │       └── Topbar.tsx
    ├── lib/
    │   ├── api.ts                     # ApiError (detail: unknown), authApi, tournamentsApi, eventsApi, usersApi, membershipsApi, sheetsApi
    │   │                              # ParseRule, ParseRuleCondition, ParseRuleAction, ValidationIssue, SheetHeadersResponse
    │   │                              # membershipsApi.deleteMembershipsByEmails — TEMP, tracked in GitHub issue
    │   │                              # sheetsApi.getEmailsForNuclearDelete — TEMP, tracked in GitHub issue
    │   ├── importMappings.ts          # MappingRow (header, field, type, row_key, extra_key, delimiter, rules), MappingsExport
    │   │                              # FieldDiff, RuleDiff, ImportSummaryEntry (fieldDiffs + ruleDiffs), ImportSummary
    │   │                              # parseMappingsJson, applyImport, mappingRowsEqual, describeRule
    │   │                              # NO parseMappingsCsv — CSV import/export removed
    │   ├── useAuth.tsx
    │   └── useTournament.tsx
    ├── middleware.ts
    ├── tailwind.config.ts
    ├── next.config.ts
    ├── .env.local
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

**Note:** `API_URL` and `API_KEY` are server-side only — used by the Next.js proxy route, never exposed to the browser.

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
- **Method:** `X-API-Key` header on ALL routes
- **Dev behavior:** if `APP_ENV=development` and `API_KEY` is blank, auth is skipped entirely
- **Prod behavior:** if `API_KEY` is missing from env, all requests get 403 (fail-closed)
- **Implementation:** `app/core/security.py` → `verify_api_key` dependency

### JWT (frontend)
- **Method:** httpOnly cookie named `access_token`, 7-day expiry, HS256
- **Cookie flags by environment:**
  - `production` — `httpOnly=True`, `secure=True`, `samesite=none`, `domain=".ethanshih.com"`
  - `preview` — `httpOnly=True`, `secure=True`, `samesite=none`, `domain=None`
  - `development` — `httpOnly=True`, `secure=False`, `samesite=lax`, `domain=None`
- **Routes:** `/auth/login/`, `/auth/logout/`, `/auth/me/`, `/auth/register/` (admin-only)
- **Dependencies:** `get_current_user`, `require_admin`, `require_permission(perm)`

### Dev seed accounts
- `admin@nexus.dev` / `admin1234` — role: `admin`
- `td@nexus.dev` / `td1234` — role: `user`, `tournament_director` membership in sample tournament

---

## Permission System

Tournament-level access is determined by `Membership.positions`. `User.role` only distinguishes `admin` from `user`.

| Permission | Access |
|---|---|
| `manage_tournament` | Full access — superset of all others |
| `manage_volunteers` | Read + write volunteer/membership pages |
| `manage_events` | Read + write events page |
| `view_volunteers` | Read-only volunteer list |
| `view_events` | Read-only events list |

### Default positions (auto-populated on tournament create)
| Position key | Label | Permissions |
|---|---|---|
| `tournament_director` | Tournament Director | `["manage_tournament"]` |
| `volunteer_coordinator` | Volunteer Coordinator | `["manage_volunteers"]` |
| `test_coordinator` | Test Coordinator | `["manage_events"]` |
| `lead_event_supervisor` | Lead Event Supervisor | `["view_events"]` |
| `event_supervisor` | Event Supervisor | `["view_events"]` |
| `runner` | Runner | `["view_events"]` |
| `scoremaster` | Scoremaster | `["view_events"]` |

---

## Database Models

### Tournament
```python
id, name, start_date, end_date, location
blocks: JSON           # [{number, label, date, start, end}, ...]
volunteer_schema: JSON # {custom_fields: [...], positions: [{key, label, permissions}, ...]}
owner_id (FK→users), created_at, updated_at
```

### SheetConfig
```python
id, tournament_id (FK→tournaments CASCADE)
label, sheet_type (interest|confirmation|events)
sheet_url, spreadsheet_id, sheet_name
column_mappings: JSON   # {header: {field, type, row_key?, extra_key?, delimiter?, rules?}}
is_active (bool), last_synced_at, created_at, updated_at
UNIQUE: (tournament_id, sheet_type)   # ← tracked for removal, see Known Issues
```

### Event
```python
id, tournament_id (FK→tournaments CASCADE)
name, division (B|C), event_type (standard|trial)
category, building, room, floor, volunteers_needed
blocks: JSON, created_at, updated_at
UNIQUE: (tournament_id, name, division)
```

### User
```python
id, first_name, last_name, email (unique), phone, shirt_size
dietary_restriction, university, major, employer
hashed_password, role ("admin"|"user"), is_active, created_at, updated_at
```

### Membership
```python
id, user_id (FK→users CASCADE), tournament_id (FK→tournaments CASCADE)
assigned_event_id (FK→events SET NULL, nullable)
positions: JSON    # ["lead_event_supervisor", "test_writer"]
schedule: JSON     # [{block: int, duty: str}, ...]
status: string     # "interested"|"confirmed"|"declined"|"assigned"|"removed"
role_preference: JSON    # ["event_volunteer", "general_volunteer"]
event_preference: JSON   # ["Boomilever", "Hovercraft"]
availability: JSON       # [{date: "YYYY-MM-DD", start: "HH:MM", end: "HH:MM"}, ...]
lunch_order, notes, extra_data: JSON, created_at, updated_at
UNIQUE: (user_id, tournament_id)
```

---

## Key Design Decisions

### Membership-based permissions
- Same user can be TD of Tournament A and volunteer in Tournament B simultaneously
- `Membership.positions` is source of truth for title + access level within a tournament
- `admin` role bypasses all tournament checks

### PATCH merge behavior
- `SheetConfig.column_mappings` — **merges**
- `Membership.extra_data` — **merges**
- `Membership.availability` — **replaces**
- All scalar fields — replace on PATCH

### Tournament access pattern
- Non-members get **404** (not 403) on read routes
- Non-members get **403** on write routes

### Duplicate sheet tab handling
- Multiple `SheetConfig`s pointing at the same `(spreadsheet_id, sheet_name)` are **allowed**
- **UX guards (frontend-only):**
  - **Sheets index:** yellow ⚠ banner + yellow card border on duplicate cards
  - **Add Sheet wizard step 2:** inline warning if tab already connected
  - **Sync:** confirmation dialog required when duplicates exist
  - **Edit page:** duplicate warning on tab selection section

### Sheet config export/import
- **Export:** JSON only (`column_mappings` + label/sheet_type/sheet_name) — available on index page (3-dot menu) and view page (top button). CSV export removed.
- **Import:** JSON only — available on new page and edit page mapping step. Non-destructive: only updates rows whose header matches.
- Import feedback: `Banner` (short summary) + `ImportSummaryModal` (full field + rule diffs)
- Logic lives in `frontend/lib/importMappings.ts`

### Sheet config import summary (ImportSummaryModal)
- Width: 720px
- Updated rows show per-field diffs (label | red old value → green new value) and per-rule diffs
- Rule diffs: unchanged (dimmed box), removed (red box), added (green box), changed (single box with rule number centered vertically — red line on top, green line below)
- Parse Rules section always shown when any rules exist; labeled "Parse Rules (unchanged)" if no changes

### Parse rules
- Stored on `ColumnMapping.rules` as ordered list of `ParseRule`
- **Data flow:** raw string → rules applied in order → type coercion → stored in DB
- **All matching rules fire** (not first-match-wins)
- **`parse_availability`** is an explicit rule action — not implicit `matrix_row` behavior
- **`replace` + `regex`** → `re.sub`; other conditions → case-insensitive literal replace
- **Validation on CREATE + PATCH** → HTTP 422 with `{ errors: ValidationIssue[], warnings: ValidationIssue[] }`. Frontend reads `e.detail` (not `e.message`) off `ApiError`.
- **Legacy coercion:** `availability_row` → `matrix_row`, `category_events` → `string` (transparent, server-side warning log)

### Membership list serialization (issue #4)
- `GET /tournaments/{id}/memberships/` returns `MembershipReadWithUser` — user data embedded inline
- Backend uses `joinedload(Membership.user)` — single JOIN, no N+1
- List endpoint returns ORM objects directly (not via `_serialize`) so Pydantic can walk the nested `user` relationship via `from_attributes=True`
- Frontend reads `m.user` directly — no `usersApi` calls

### Google Forms multi-select parsing patterns
**Pattern 1 — Options with appended descriptions:**
```json
{ "condition": "contains", "match": " - Full description.", "action": "replace", "value": "" }
```
One rule per option. After stripping, string splits cleanly on `,`.

**Pattern 2 — Options with parenthetical sub-lists:**
```json
[
  { "condition": "regex", "match": "\\) ?, ?", "action": "replace", "value": ";" },
  { "condition": "regex", "match": " \\([^)]+\\)", "action": "replace", "value": "" }
]
```
Set `"delimiter": ";"`. Rule 1 replaces `)` separator with `;`. Rule 2 strips parenthetical content.

---

## column_mappings — Rich ColumnMapping Structure

**6 mapping types:**
| Type | Description |
|---|---|
| `string` | Store as-is |
| `ignore` | Skip column |
| `boolean` | "Yes"/"No" → true/false |
| `integer` | Parse to int |
| `multi_select` | Split on `delimiter` (default `,`) → JSON array. Rules run before splitting. |
| `matrix_row` | Availability grid row → merged into availability JSON. Requires `row_key`. Must have `parse_availability` rule. |

**Optional ColumnMapping fields:**
- `row_key` — required for `matrix_row`
- `extra_key` — required for `extra_data` field
- `delimiter` — only valid on `multi_select`, default `,`
- `rules` — ordered list of `ParseRule`

**ParseRule fields:**
- `condition`: `always` | `contains` | `equals` | `starts_with` | `ends_with` | `regex`
- `match`: required unless `always`
- `case_sensitive`: bool (default false)
- `action`: `set` | `replace` | `prepend` | `append` | `discard` | `parse_availability`
- `value`: required for `set` / `replace` / `prepend` / `append`

**KNOWN_FIELDS:** `__ignore__`, `first_name`, `last_name`, `email`, `phone`, `shirt_size`, `dietary_restriction`, `university`, `major`, `employer`, `role_preference`, `event_preference`, `availability`, `lunch_order`, `notes`, `extra_data`

---

## Frontend Design System

### Fonts
- **`--font-serif`** → Georgia — h1, h2, page titles, wordmarks
- **`--font-sans`** → Geist — UI labels, buttons, nav, badges
- **`--font-mono`** → Geist Mono — body text, inputs, data values, emails, dates

### Colors
- `--color-bg`: `#F7F7F5` | `--color-surface`: `#FFFFFF`
- `--color-accent`: `#0A0A0A` | `--color-accent-subtle`: `#F0F0EC`
- `--color-danger`: `#E53E3E` | `--color-success`: `#22C55E` | `--color-warning`: `#EAB308`
- `--color-border`: `#E2E2DE` | `--color-border-strong`: `#C8C8C2`
- `--color-text-primary`: `#0A0A0A` | `--color-text-secondary`: `#6B6B65` | `--color-text-tertiary`: `#9B9B93`

### Component conventions
- **Always use `Button`** — never raw `<button>` for actions
- **Always use `Select`** — never raw `<select>`. Custom themed dropdown with keyboard nav, fixed-position panel (avoids z-index/overflow clipping), `sm`/`md` sizes, `minWidth` prop, option groups supported. Use `size="sm"` for compact inline controls (rule editor, table rows). Import from `@/components/ui/Select`.
- **Always use `Input`** for text fields — `font` prop accepts `"sans"` (default) | `"mono"` | `"serif"`. `var(--color-surface)` background so fields stand out against page bg.
- **Always use `Banner`** for inline feedback — replaces toast pattern
- **Always use `ImportSummaryModal`** for import diffs
- **Always use `PageHeader`** for page title + subtitle + action
- **Always use `EmptyState`** for empty list states
- **All SVG icons in `Icons.tsx`** — never define inline
- **`SplitButton`** — no longer used for import/export (removed). Import is plain `Button`, export is plain `Button`.

### SheetConfigMappingTable
Shared mapping table used by new/view/edit pages. Import from `@/components/ui/SheetConfigMappingTable`.

**Props:** `rows: RichMappingRow[]`, `knownFields`, `validTypes`, `validConditions`, `validActions`, `onChangeRow` (omit for view-only), `viewOnly`, `baselineLabel` (default `"suggestion"`, pass `"saved"` on edit page), `validationErrors`, `validationWarnings`

**Row states:** same · changed (amber) · new (green) · removed (red)

**Accordion behavior:**
- Rows with rules: open by default, chevron in last column, click row background (not controls) to toggle. Animated via `grid-template-rows` 0fr→1fr (220ms).
- Rows without rules (not ignored): plus icon in last column, clicking it adds the first rule and opens accordion.
- Ignored/removed rows: no icon, no accordion.
- Auto-closes when last rule is removed.

**Diff tooltip:** hover on changed rows shows "Changes from {baselineLabel}" (and "Changes from import" if edited post-import). Shows full field diffs and rule diffs with red/green. Divider between sections only shown when both sections have content.

**Rule editor:** `condition` and `action` use `Select size="sm"`. `match` and `value` inputs are 300px mono, local state flushed on blur (no per-keystroke parent re-renders). `RuleRow`, `RulesPanel`, `MappingRowComponent` all wrapped in `React.memo`. Stable per-row `onChange` callbacks via ref map.

**`makeRichRow(values, baseline, forcedState?, importedValue?)`** — helper to build `RichMappingRow`.

**importMappings.ts exports:** `MappingRow`, `MappingsExport`, `FieldDiff`, `RuleDiff`, `ImportSummaryEntry`, `ImportSummary`, `parseMappingsJson`, `applyImport`, `mappingRowsEqual`, `describeRule`

### Volunteers page
- Multi-select fields (role_preference, event_preference, positions, array extra_data values) render as tag pills
- Availability renders as stacked date + time rows: `May 21   8 AM–6 PM` — date in sans 500 weight, time in mono
- `fmtTime`: `"08:00"` → `"8 AM"`, `"12:00"` → `"12 PM"`, `"14:30"` → `"2:30 PM"`
- `fmtDate`: parses `YYYY-MM-DD` without timezone shift to avoid off-by-one date errors
- Extra data columns: `minWidth: 240px`, `maxWidth: 360px`

### Dashboard design
- **`/dashboard`** — tournament card grid, `Topbar showWordmark showAvatar`
- **`/dashboard/[id]/*`** — sidebar + `Topbar showDropdown showAvatar`
- Sidebar: 52px collapsed / 192px expanded, in normal flow

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
GET    /tournaments/{id}/
PATCH  /tournaments/{id}/
DELETE /tournaments/{id}/

# Events
GET    /tournaments/{id}/events/
GET    /tournaments/{id}/events/{event_id}/
POST   /tournaments/{id}/events/
PATCH  /tournaments/{id}/events/{event_id}/
DELETE /tournaments/{id}/events/{event_id}/

# Memberships
GET    /tournaments/{id}/memberships/                       # returns MembershipReadWithUser (user inline)
GET    /tournaments/{id}/memberships/{membership_id}/
POST   /tournaments/{id}/memberships/
PATCH  /tournaments/{id}/memberships/{membership_id}/
DELETE /tournaments/{id}/memberships/{membership_id}/

# Users (admin-only global)
GET    /users/
GET    /users/{id}/
GET    /users/by-email/{email}/
PATCH  /users/{id}/
DELETE /users/{id}/
GET    /tournaments/{id}/users/{user_id}/

# Sheets
POST   /tournaments/{id}/sheets/validate/
POST   /tournaments/{id}/sheets/headers/                   # returns valid_rule_conditions + valid_rule_actions
GET    /tournaments/{id}/sheets/configs/
POST   /tournaments/{id}/sheets/configs/                   # runs validate_column_mappings → 422 on errors
GET    /tournaments/{id}/sheets/configs/{config_id}/
PATCH  /tournaments/{id}/sheets/configs/{config_id}/       # runs validate_column_mappings → 422 on errors
DELETE /tournaments/{id}/sheets/configs/{config_id}/
POST   /tournaments/{id}/sheets/configs/{config_id}/sync/

# Planned (not yet built)
POST   /tournaments/{id}/memberships/delete-by-emails/
GET    /tournaments/{id}/sheets/configs/{config_id}/rows/
```

---

## Test Infrastructure

**conftest.py key fixtures:**
- `db` — in-memory SQLite with foreign keys ON, transaction rollback after each test
- `mock_sheets_service` — MagicMock(spec=SheetsService)
- `client` — TestClient with get_db, get_sheets_service overrides
- `admin_user`, `td_user`, `other_user`, `td_tournament`, `other_tournament`
- `login(client, email, password)` — helper

---

## Development Phases

- [x] **Phase 1** — Tournament model
- [x] **Phase 2** — Event model
- [x] **Phase 3** — User + Membership models
- [x] **Phase 4** — Rich `ColumnMapping` structure
- [x] **Phase 5** — Sync service: upsert, availability parsing + merging
- [x] **Phase 6** — Deploy backend (Railway + PostgreSQL, API key auth, Alembic)
- [x] **Phase 7 — Frontend**
  - [x] **7a** — Design system scaffold
  - [x] **7b** — Landing page
  - [x] **7c** — Auth wiring
  - [x] **7d** — App shell (sidebar, topbar, routing)
  - [x] **7e** — Sheets UI + frontend refactor
  - [ ] **7f** — Events + volunteers tables (proper)
  - [ ] **7g** — Assignment dashboard
- [x] **Phase 8** — Membership-based permissions
- [x] **Phase 9** — Preview environments
- [x] **Issue #4** — Membership list inline user data
- [x] **feat/sheet-config-parse-rules** — Parse rules feature (backend + frontend)
- [x] **feat/sheet-config-parse-rules-ux** — Parse rules UX polish (see below)
- [x] **feat/volunteers-display** — Volunteer table display improvements

### feat/sheet-config-parse-rules-ux ✓

- **CSV import/export removed** — JSON only. Export on index (3-dot menu) and view page. Import on new/edit pages.
- **ImportSummaryModal** — 720px wide. Full per-field diffs (red→green inline). Full per-rule diffs in single-box layout (rule number centered, red/green stacked). Rule section always visible when rules exist.
- **Diff tooltip** — same red/green rule diff boxes as modal. Divider between sections only when both sections have content. Fixes orphaned divider when section 1 is empty.
- **Edit page import bug fixed** — new-state rows now go through `makeRichRow` so diff tooltip works.
- **Rule editor inputs** — 300px fixed width, mono font on both `match` and `value`. Local state flushed on blur to eliminate per-keystroke re-renders.
- **Performance** — `RuleRow`, `RulesPanel`, `MappingRowComponent` wrapped in `React.memo`. Stable per-row `onChange` via ref map. Eliminates table-wide re-renders on keystroke.
- **Accordion** — open by default when row has rules. Plus icon on no-rule rows (adds first rule + opens). Animated 220ms via `grid-template-rows`. Auto-closes when last rule removed. `mounted` state keeps panel in DOM for close animation.
- **Ignored rows** — `var(--color-bg)` background (distinct from surface). No chevron/plus.
- **Select component** — custom themed, replaces all native `<select>` in table and edit page. Fixed-position panel escapes overflow clipping. `sm`/`md` sizes. Option groups supported. `stopPropagation` on trigger prevents accordion toggle.
- **Input component** — `font` prop added (`sans`/`mono`/`serif`).
- **Edit page top fields** — Label uses `Input font="sans"`, Sheet Type and Sheet Tab use `Select`. Background is `var(--color-surface)` so fields stand out.

### feat/volunteers-display ✓

- Multi-select fields render as tag pills (`TagList` component)
- Availability: stacked date + time rows per slot (Option A)
- Array values in `extra_data` auto-detected and rendered as tags
- Extra data columns widened to `minWidth: 240px` / `maxWidth: 360px`

---

## Branch Strategy & Issue Tracking

Backend and frontend changes on **separate feature branches**, PRed independently.

```
feature/backend-*   →  staging  →  main
feature/frontend-*  →  staging  →  main
```

When a backend bug is found during frontend work: document here + open GitHub issue. Don't block frontend progress unless the frontend cannot function without the fix.

---

## Known Issues / Future Work
- Full sheet sync on every run — "sync only new rows" is a future optimization
- Railway trial period — may migrate backend to Render
- **[GitHub issue] Remove `UNIQUE(tournament_id, sheet_type)` constraint** — too restrictive. Fix: Alembic migration + remove `UniqueConstraint` from `app/models/models.py`. Currently triggers unhandled 500.
- **[GitHub issue] `DateTime` columns serialized without timezone info** — causes incorrect local time display. Temp fix: `fmtDateTime` appends `Z` if no suffix. Proper fix: `DateTime(timezone=True)` + migration + remove frontend normalization.
- **[GitHub issue] Bulk membership delete + raw sheet row endpoints** — two temp implementations in `api.ts` need proper routes: `POST /tournaments/{id}/memberships/delete-by-emails/` and `GET /tournaments/{id}/sheets/configs/{configId}/rows/`.
- **[GitHub issue] Add `sheet_config_ids` to Membership** — provenance tracking.
- **`SplitButton`** — still exists in codebase but no longer used for import/export. Can be removed or repurposed.

---

## Deployment

### Backend (Railway)
- Root directory: `backend`, start command via `Procfile`
- Migrations: `$env:DATABASE_URL="<public_url>"; python -m alembic upgrade head`
- Secrets: `APP_ENV`, `API_KEY`, `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`
- Custom domain: `nexus-api.ethanshih.com`

### Frontend (Vercel)
- Root directory: `frontend`, server-side env vars: `API_URL`, `API_KEY`
- Custom domain: `nexus.ethanshih.com`
- Every branch push auto-generates a preview deployment

### Preview environment
- Railway preview: `nexus-preview.up.railway.app`
- Railway preview public DB: `postgresql://postgres:...@yamanote.proxy.rlwy.net:31907/railway`
- Railway prod public DB: `postgresql://postgres:...@interchange.proxy.rlwy.net:19714/railway`

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

**Parse rule patterns for this form:**
- `Volunteering Role Preference` → `multi_select`, two `contains` + `replace` rules stripping descriptions
- `If interested in event volunteering...` → `multi_select`, `delimiter: ";"`, two regex rules: replace `\) ?, ?` with `;` then strip ` \([^)]+\)`
- `If you are interested in general volunteer...` → `multi_select`, `contains` + `replace` per option
- All availability rows → `matrix_row` + `parse_availability` rule (`always` condition)
- `Do you have any potential conflict of interests?` → `extra_data` `string`
