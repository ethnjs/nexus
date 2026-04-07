# NEXUS — Science Olympiad Tournament Manager
## Project Context Document
*Last updated: fix/sync-parse-time-range — _apply_rules handles parse_time_range + parse_availability, sync route arg order fix, test suite alignment*

> **Stylization:** Always **NEXUS** (all caps) in UI/docs. Lowercase `nexus` only in code/URLs.
> **API version:** `0.2.0`

---

## Overview
Full-stack dashboard for Science Olympiad tournament directors to manage volunteer logistics, event assignments, and tournament data. Data flows: **Google Forms → Google Sheets → NEXUS**.

- **Root:** `nexus/` with `backend/` and `frontend/`
- **Run backend:** `uvicorn app.main:app --reload --port 8001` (port 8000 is blocked)
- **Swagger:** `http://localhost:8001/docs`
- **Production API:** `https://nexus-api.ethanshih.com` (Railway)
- **DB migrations:** `alembic upgrade head` (do NOT delete nexus.db)

---

## Tech Stack
- **Backend:** Python 3.13, FastAPI, SQLAlchemy 2.0.36 (classic `Column()` style — NOT `Mapped[]`), SQLite (dev) / PostgreSQL (prod), Pytest
- **Frontend:** Next.js 15, React, TypeScript, TailwindCSS, Vercel
- **Google Sheets + Forms API:** service account credentials — file in dev (`credentials.json`), env var in prod (`GOOGLE_SERVICE_ACCOUNT_JSON`)
- **Hosting:** Railway (backend + PostgreSQL), Vercel (frontend) — may migrate to Render after Railway trial

---

## Domains
- **Frontend:** `nexus.ethanshih.com` → Vercel
- **Backend:** `nexus-api.ethanshih.com` → Railway
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
│   │   │   └── permissions.py         # Permission constants, DEFAULT_POSITIONS, require_permission()
│   │   ├── db/
│   │   │   ├── session.py             # Engine, SessionLocal, get_db()
│   │   │   └── init_db.py             # create_all() + dev seed (skips during pytest)
│   │   ├── models/models.py           # All SQLAlchemy ORM models
│   │   ├── schemas/
│   │   │   ├── tournament.py          # Tournament + TournamentBlock + PositionDefinition + VolunteerSchema
│   │   │   ├── event.py
│   │   │   ├── user.py
│   │   │   ├── membership.py          # Membership + AvailabilitySlot + ScheduleSlot
│   │   │   ├── sheet_config.py        # SheetConfig + ColumnMapping + ParseRule + MappedHeader
│   │   │   │                          # SheetHeadersResponse (flat mappings list)
│   │   │   │                          # ValidateMappingsRequest/Response
│   │   │   │                          # SheetConfigReadWithWarnings
│   │   │   └── auth.py
│   │   ├── services/
│   │   │   ├── sheets_service.py      # Google Sheets API + flat get_headers() with dedup
│   │   │   ├── forms_service.py       # Google Forms API — get_form_questions() → list[dict]
│   │   │   ├── sync_service.py        # Sync logic: upsert users/memberships, parse rules engine
│   │   │   └── sheets_validation.py   # validate_column_mappings() — ValidationIssue, ValidationResult
│   │   └── api/routes/
│   │       ├── auth.py                # Login, logout, me, register
│   │       ├── tournaments.py
│   │       ├── events.py              # Nested under /tournaments/{id}/events/
│   │       ├── users.py               # Admin-only global + tournament-scoped
│   │       ├── memberships.py         # Nested under /tournaments/{id}/memberships/
│   │       └── sheets.py              # Sheet config CRUD + validate-mappings + headers endpoint
│   │                                  # get_forms_service() dependency added
│   │                                  # CREATE/PATCH return SheetConfigReadWithWarnings
│   ├── tests/
│   │   ├── conftest.py                # In-memory SQLite, fixtures: admin_user, td_user, td_tournament,
│   │   │                              # client, mock_sheets_service, mock_forms_service
│   │   ├── api/
│   │   │   ├── test_auth.py, test_tournaments.py, test_events.py
│   │   │   ├── test_users.py, test_memberships.py, test_sheets.py, test_sync.py
│   │   └── services/
│   │       ├── test_sheets_service.py  # Updated for flat MappedHeader API
│   │       ├── test_forms_service.py   # Updated for plain dict return shape
│   │       ├── test_sync_service.py
│   │       └── test_sheets_validation.py
│   ├── alembic/                       # Migrations
│   ├── conftest.py, alembic.ini, Procfile, pytest.ini, requirements.txt
└── frontend/
    ├── app/
    │   ├── globals.css                # Design tokens, Geist Sans + Mono + Georgia
    │   ├── layout.tsx, page.tsx       # Landing page + login form
    │   └── dashboard/
    │       ├── layout.tsx, page.tsx   # Tournament card grid
    │       └── [tournamentId]/
    │           ├── layout.tsx         # TournamentProvider + Sidebar + Topbar
    │           ├── overview/page.tsx, assignments/page.tsx, events/page.tsx, settings/page.tsx
    │           ├── volunteers/page.tsx # Volunteer table — tags, availability rows, extra_data
    │           └── sheets/
    │               ├── page.tsx       # Sheets index — cards, export, sync, duplicate warnings
    │               ├── new/page.tsx   # Add Sheet wizard — validate-first save flow
    │               └── [configId]/
    │                   ├── page.tsx   # View sheet config — read-only table, export, danger zone
    │                   └── edit/page.tsx # Edit sheet config — validate-first save flow
    ├── components/ui/
    │   ├── Button.tsx                 # primary/secondary/ghost/danger, sm/md/lg, loading
    │   ├── Input.tsx                  # label, error, helper, font prop (sans/mono/serif)
    │   ├── Select.tsx                 # Custom dropdown — keyboard nav, sm/md sizes, minWidth,
    │   │                              # background props, fixed-position panel, stopPropagation
    │   ├── Card.tsx, Badge.tsx
    │   ├── Icons.tsx                  # ALL SVG icons — never define inline
    │   ├── Modal.tsx, NewTournamentModal.tsx
    │   ├── Banner.tsx                 # success/error/warning/info, optional action + dismiss
    │   ├── ImportSummaryModal.tsx     # Full field + rule diffs, 720px wide
    │   ├── SheetConfigMappingTable.tsx # See detailed notes below
    │   ├── SheetMappingValidationModals.tsx # Two exports:
    │   │                              # SheetMappingValidationErrorsModal (X to close)
    │   │                              # SheetMappingValidationWarningsModal (Go back / Sync anyway)
    │   ├── FieldLabel.tsx, PageHeader.tsx, StepIndicator.tsx, RadioOption.tsx
    │   ├── StatCard.tsx, EmptyState.tsx, UserAvatar.tsx
    │   └── SplitButton.tsx            # Unused — can be removed
    ├── components/layout/
    │   ├── Sidebar.tsx                # 52px collapsed / 192px expanded, in normal flow
    │   └── Topbar.tsx                 # showWordmark | showDropdown | showAvatar props
    ├── lib/
    │   ├── api.ts                     # All API types + fetch wrapper — NEEDS UPDATE (see below)
    │   ├── importMappings.ts          # MappingRow, MappingsExport, ImportSummary types
    │   │                              # parseMappingsJson, applyImport, mappingRowsEqual, describeRule
    │   ├── useSheetValidation.tsx     # Shared validation hook — new + edit sheet pages
    │   ├── useAuth.tsx, useTournament.tsx
    ├── middleware.ts                  # Protect /dashboard/*, redirect if logged in on /
    ├── tailwind.config.ts, next.config.ts, .env.local, package.json
```

---

## Environment & Config

**.env (local dev):**
```
APP_ENV=development
APP_PORT=8001
DATABASE_URL=sqlite:///./nexus.db
GOOGLE_SERVICE_ACCOUNT_FILE=./credentials.json
API_KEY=                              # leave blank to skip auth in dev
JWT_SECRET=dev-secret-change-in-production
```

**Railway production:** `APP_ENV`, `DATABASE_URL`, `API_KEY`, `JWT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`
**Railway preview:** same + preview postgres URL
**Vercel production:** `API_URL=https://nexus-api.ethanshih.com`, `API_KEY`
**Vercel preview:** `API_URL=https://nexus-preview.up.railway.app`, `API_KEY`
**frontend/.env.local:** `NEXT_PUBLIC_API_URL=http://localhost:8001`

`API_URL` and `API_KEY` are server-side only — Next.js proxy, never exposed to browser.

**pytest.ini:**
```ini
testpaths=tests
asyncio_mode=auto
asyncio_default_fixture_loop_scope=function
pythonpath=.
filterwarnings = ignore::DeprecationWarning:jose
```

---

## Authentication

### API Key
`X-API-Key` header on all routes. Dev: blank = skip. Prod: missing = 403.
`APP_ENV=test` with blank `API_KEY` also skips — used by GitHub Actions CI.

### JWT (frontend)
httpOnly cookie `access_token`, 7-day expiry, HS256.
- `production` — `secure=True`, `samesite=none`, `domain=".ethanshih.com"`
- `preview` — `secure=True`, `samesite=none`, `domain=None`
- `development` — `secure=False`, `samesite=lax`, `domain=None`

### Dev seed accounts
- `admin@nexus.dev` / `admin1234` — role: `admin`
- `td@nexus.dev` / `td1234` — `tournament_director` in sample tournament

---

## Permission System

`Membership.positions` is source of truth for tournament-level access. `User.role` only distinguishes `admin` from `user`.

| Permission | Access |
|---|---|
| `manage_tournament` | Full access — superset of all others |
| `manage_volunteers` | Read + write volunteers |
| `manage_events` | Read + write events |
| `view_volunteers` | Read-only volunteer list |
| `view_events` | Read-only events list |

### Default positions (auto-created on tournament create)
| Key | Label | Permissions |
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
blocks: JSON           # [{number, label, date: "YYYY-MM-DD", start: "HH:MM", end: "HH:MM"}, ...]
volunteer_schema: JSON # {custom_fields: [...], positions: [{key, label, permissions}, ...]}
owner_id (FK→users), created_at, updated_at
```

### SheetConfig
```python
id, tournament_id (FK→tournaments CASCADE)
label, sheet_type ("volunteers"|"events")   # interest/confirmation coerced → volunteers on read
sheet_url, spreadsheet_id, sheet_name
column_mappings: JSON   # {header: {field, type, row_key?, extra_key?, delimiter?, rules?}}
is_active (bool), last_synced_at, created_at, updated_at
# UNIQUE(tournament_id, sheet_type) constraint has been REMOVED
```

### Event
```python
id, tournament_id (FK→tournaments CASCADE)
name, division (B|C), event_type (standard|trial)
category, building, room, floor, volunteers_needed
blocks: JSON   # [14, 15, 16, ...] block numbers
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
lunch_order, notes, extra_data: JSON
UNIQUE: (user_id, tournament_id)
```

---

## Key Design Decisions

### Save flow for new/edit sheet pages (validate-first)
Both pages validate before any DB write:
1. Save / Save & Sync → `POST /sheets/configs/validate-mappings/` (no DB write)
2. Hard errors → inline on table + `SheetMappingValidationErrorsModal`. Stop.
3. Warnings only (first time) → inline on table. Stop. User sees highlighted rows.
4. Save / Save & Sync again (warnings already shown) → `SheetMappingValidationWarningsModal` (Go back / Sync anyway)
5. Confirmed → `createConfig`/`updateConfig` + `sync`

`POST /sheets/configs/validate-mappings/` always returns `200 { ok, errors, warnings }`. `ok: true` even with warnings — informational, not failures. CREATE and PATCH also return `SheetConfigReadWithWarnings` as a safety net.

### useSheetValidation hook
Shared between new and edit pages. Import from `@/lib/useSheetValidation`.

Exports: `validationErrors`, `validationWarnings`, `validationGeneration`, `clearAll()`, `clearRow(header)`, `handle422(e)`, `handleValidateResult(result)`, `handleSaveSuccess(body)`, `setGenericError(msg)`, `renderErrorBanner()`.

- `handleValidateResult` returns `{ ok, shouldConfirm }`. `shouldConfirm` is true only when warnings were already shown on a previous attempt (tracked via `warningsShown` ref).
- `handle422` handles both structured `{ errors, warnings }` format AND raw Pydantic error arrays (parsed from `loc` — handles the case where Pydantic rejects before our validator runs).
- `validationGeneration` increments on each new validate result — passed as prop to `SheetConfigMappingTable` to open accordions for rule-level issues.

### ValidationIssue.header
`list[str] | str | null` in Python. Backend always serialises as `list[str] | null`. Duplicate `extra_key` errors pass the full list — no comma-joining (headers can contain commas). Frontend uses `matchesHeader()` with `Array.isArray`.

### ParseRule validation
`ParseRule.model_validator` removed from Pydantic schema. All business logic (regex compiles, match required, value required, parse_time_range condition) lives exclusively in `sheets_validation.py`. Pydantic only validates `condition`/`action` against allowed sets. This prevents Pydantic from rejecting requests before our structured validator runs.

### SheetConfigMappingTable
Shared by new/view/edit pages. Import from `@/components/ui/SheetConfigMappingTable`.

**Props:** `rows: RichMappingRow[]`, `knownFields`, `validTypes`, `validConditions`, `validActions`, `onChangeRow` (omit for view-only), `viewOnly`, `baselineLabel` (default `"suggestion"`, use `"saved"` on edit page), `validationErrors`, `validationWarnings`, `validationGeneration`

**Row states:** same · changed (orange-amber `#FFF7ED`/`#FDBA74`) · new (green) · removed (red)

**Accordion:**
- Rows with rules: open by default via `useState(hasRules || openOnMount)`. Chevron in last column, click row background toggles. Not shown in `viewOnly`.
- Rows without rules (not ignored): plus icon → adds first rule + opens.
- Ignored/removed rows: no icon, no accordion.
- Auto-closes when last rule removed. Animated via `grid-template-rows` 220ms.
- `openOnMount` on `RichMappingRow` — read at mount + watched via `useEffect` for already-mounted rows. Set atomically in same `setMappingRows` call as import data; cleared via 100ms setTimeout.
- `validationGeneration` triggers `useEffect` → opens accordion for rows with rule-level issues (`rule_index != null`).

**Error/warning UX:**
- Row bg turns red/yellow when errors/warnings exist.
- Rules badge turns red/yellow only for rule-level issues. Field-level errors don't affect badge.
- Hover tooltip shows ERRORS / WARNINGS sections. Rule-level issues prefixed with `Rule N` (flex layout, wraps cleanly). Field-level issues no prefix.
- Error/diff tooltips show side-by-side when both present (error offset 420px right).

**`makeRichRow(values, baseline, forcedState?, importedValue?, openOnMount?)`** — helper to build `RichMappingRow`.

**Rule editor:** `Select size="sm"` for condition/action. `match`/`value` inputs 300px mono, local state flushed on blur (no per-keystroke re-renders). `RuleRow`, `RulesPanel`, `MappingRowComponent` wrapped in `React.memo`. Stable per-row `onChange` via ref map.

**`RichMappingRow` fields (current):** `header`, `field`, `type`, `row_key`, `extra_key`, `rules`, `delimiter`, `showAliasEditor`, `formQuestion`, `state`, `openOnMount`

**NEEDS UPDATE — `RichMappingRow` will gain `googleType?: string`** once the frontend is updated for the new backend response. When `googleType` is present, the Type dropdown in the table must be rendered as **read-only text** (hard lock — no Select). See Frontend Work section below.

### Sheet config export/import
- **Export:** JSON only. Index (3-dot menu) and view page.
- **Import:** JSON only. New/edit pages. Non-destructive (only updates matching headers). Rules fully replaced (not merged) — if import has 2 rules and saved has 3, result is 2.
- `describeRule()` shows empty string values as `""`.
- After import, rows with rule changes get `openOnMount: true` → accordions open.

**importMappings.ts exports:** `MappingRow`, `MappingsExport`, `FieldDiff`, `RuleDiff`, `ImportSummaryEntry`, `ImportSummary`, `parseMappingsJson`, `applyImport`, `mappingRowsEqual`, `describeRule`

### Membership list
`GET /memberships/` returns `MembershipReadWithUser` — user data inline via `joinedload`. Frontend reads `m.user` directly — no extra API calls.

### Volunteers page
- Multi-select fields (role_preference, event_preference, positions, array extra_data) render as tag pills.
- Availability: stacked date + time rows (`May 21  8 AM–6 PM`). `fmtDate` avoids timezone shift.
- Extra data columns: `minWidth: 240px`, `maxWidth: 360px`. Arrays auto-rendered as tags.

### Duplicate sheet tab handling
- Multiple `SheetConfig`s on same `(spreadsheet_id, sheet_name)` are **allowed**.
- UX guards (frontend only): yellow warning banners on index cards, inline warning in wizard step 2, sync confirmation dialog when duplicates exist.

### PATCH merge behavior
- `SheetConfig.column_mappings` — **merges** (incoming keys merged into existing)
- `Membership.extra_data` — **merges**
- `Membership.availability` — **replaces**
- All scalar fields — replace

### Tournament access pattern
- Non-members: **404** on read routes, **403** on write routes
- `admin` bypasses all tournament checks

### Google Forms multi-select patterns
**Pattern 1 — Appended descriptions:**
```json
{ "condition": "contains", "match": " - Full description.", "action": "replace", "value": "" }
```
One rule per option. String splits cleanly on `,` after stripping.

**Pattern 2 — Parenthetical sub-lists:**
```json
[
  { "condition": "regex", "match": "\\) ?, ?", "action": "replace", "value": ";" },
  { "condition": "regex", "match": " \\([^)]+\\)", "action": "replace", "value": "" }
]
```
Set `"delimiter": ";"`. Rule 1 replaces `)` separator with `;`. Rule 2 strips parenthetical content.

---

## column_mappings Structure

**6 types:**
| Type | Description |
|---|---|
| `string` | Store as-is |
| `ignore` | Skip column |
| `boolean` | "Yes"/"No" → true/false |
| `integer` | Parse to int |
| `multi_select` | Split on `delimiter` (default `,`) → JSON array. Rules run before splitting. |
| `matrix_row` | One row of availability grid → merged into availability JSON. Requires `row_key`. Use `parse_time_range` rule (or legacy `parse_availability`). |

**ParseRule fields:**
- `condition`: `always` | `contains` | `equals` | `starts_with` | `ends_with` | `regex`
- `match`: required unless `always`; `case_sensitive`: bool (default false)
- `action`: `set` | `replace` | `prepend` | `append` | `discard` | `parse_time_range` | `parse_availability` (legacy alias)
- `value`: required for `set`/`replace`/`prepend`/`append`

All matching rules fire sequentially (not first-match). `parse_time_range` (canonical) / `parse_availability` (accepted as legacy alias) must be added as a rule on `matrix_row` fields — not implicit. `replace` + `regex` → `re.sub`; other conditions → case-insensitive literal replace.

**Validation runs on validate-mappings + CREATE + PATCH** → 422 with `{ errors: [], warnings: [] }` on hard errors.

**VOLUNTEER_KNOWN_FIELDS:** `__ignore__`, `first_name`, `last_name`, `email`, `phone`, `shirt_size`, `dietary_restriction`, `university`, `major`, `employer`, `role_preference`, `event_preference`, `availability`, `lunch_order`, `notes`, `extra_data`

**EVENT_KNOWN_FIELDS:** `__ignore__`, `extra_data` (stub — fields TBD when events import is implemented)

---

## SheetHeadersResponse — New Flat Shape

**BREAKING CHANGE** from the previous `headers + suggestions + form_questions` triple.

The `/headers/` endpoint now returns:
```typescript
interface SheetHeadersResponse {
  sheet_name:            string
  sheet_type:            string           // "volunteers" | "events"
  mappings:              MappedHeader[]   // one per sheet column, ordered
  known_fields:          string[]         // scoped to sheet_type
  valid_types:           string[]
  valid_rule_conditions: string[]
  valid_rule_actions:    string[]
}

interface MappedHeader {
  header:       string                    // raw column header from sheet
  field:        string                    // suggested target field
  type:         string                    // suggested mapping type
  row_key?:     string
  extra_key?:   string
  rules?:       ParseRule[]
  delimiter?:   string
  // Form enrichment — null when no form URL or no question matched
  google_type?:  string                   // raw Forms API type e.g. "CHECKBOX", "GRID", "TEXT"
  options?:      FormQuestionOption[]     // for CHECKBOX / MULTIPLE_CHOICE / DROP_DOWN
  grid_rows?:    string[]                 // for GRID questions — row labels
  grid_columns?: string[] 　             // for GRID questions — column labels
}

interface FormQuestionOption {
  raw:   string   // exact string from the form
  alias: string   // auto-suggested short version
}
```

**Request body** also changed — `sheet_type` is now required, `form_url` is optional:
```typescript
interface SheetHeadersRequest {
  sheet_url:  string
  sheet_name: string
  sheet_type: "volunteers" | "events"     // REQUIRED — was missing before
  form_url?:  string                      // optional — triggers FormsService call
}
```

**Deduplication:** The backend ensures no two headers map to the same `field` or `(extra_data, extra_key)` pair. Collisions fall back to `{ field: "__ignore__", type: "ignore" }`. `availability` is exempt (multiple `matrix_row` rows share it). `__ignore__` is never claimed.

**Type lock:** When `google_type` is present on a `MappedHeader`, the Type dropdown in the mapping table must be rendered as **read-only text** — the form told us the type, TDs cannot override it.

**Auto-attached rule:** All `matrix_row` mappings to `availability` always come with a `parse_time_range` rule pre-attached, regardless of whether form data is present.

---

## Frontend Work Required (feature/frontend-headers-refactor)

The backend `SheetHeadersResponse` shape changed. The frontend still uses the old `headers + suggestions + form_questions` shape. All of the following files need updating.

### `frontend/lib/api.ts`

**Add/update types:**
```typescript
export type SheetType = 'volunteers' | 'events'   // was 'interest' | 'confirmation' | 'events'

export type ParseRuleAction = 'set' | 'replace' | 'prepend' | 'append' | 'discard'
  | 'parse_time_range'      // canonical — add this
  | 'parse_availability'    // legacy alias — keep for backwards compat

export interface FormQuestionOption {
  raw:   string
  alias: string
}

export interface MappedHeader {
  header:       string
  field:        string
  type:         string
  row_key?:     string
  extra_key?:   string
  rules?:       ParseRule[]
  delimiter?:   string
  google_type?: string
  options?:     FormQuestionOption[]
  grid_rows?:   string[]
  grid_columns?: string[]
}

export interface SheetHeadersResponse {
  sheet_name:            string
  sheet_type:            string
  mappings:              MappedHeader[]   // replaces headers + suggestions + form_questions
  known_fields:          string[]
  valid_types:           string[]
  valid_rule_conditions: string[]
  valid_rule_actions:    string[]
}
```

**Remove:** `FormQuestion` interface, `SheetHeadersResponse.headers`, `SheetHeadersResponse.suggestions`, `SheetHeadersResponse.form_questions`

**Update `sheetsApi.headers()`** to pass `sheet_type` (required) and optional `form_url`:
```typescript
headers: (tournamentId: number, sheet_url: string, sheet_name: string,
          sheet_type: SheetType, form_url?: string) =>
  api.post<SheetHeadersResponse>(
    `/tournaments/${tournamentId}/sheets/headers/`,
    { sheet_url, sheet_name, sheet_type, form_url }
  ),
```

### `frontend/components/ui/SheetConfigMappingTable.tsx`

**`RichMappingRow` gains `googleType?: string`:**
```typescript
interface RichMappingRow {
  // ... existing fields ...
  googleType?: string    // from MappedHeader.google_type
}
```

**Type column hard lock:** When `row.googleType` is set, render the Type cell as read-only text instead of a `<Select>`. Example:
```tsx
{row.googleType ? (
  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-secondary)' }}>
    {TYPE_LABELS[row.type] ?? row.type}
  </span>
) : (
  <Select ... />  // existing type dropdown
)}
```

**`makeRichRow`** must pass `googleType` through from the source `MappedHeader`.

### `frontend/app/dashboard/[tournamentId]/sheets/new/page.tsx`

**Step 2 — Sheet type:** Update options from `interest / confirmation / events` to `volunteers / events`.

**Step 3 — Form URL step:** Already exists (from the forms API feature). Ensure `fetchHeaders` passes `sheet_type` and `form_url` to `sheetsApi.headers()`.

**`handleFetchHeaders` simplification** — no more client-side cross-referencing. Map `result.mappings` directly to `RichMappingRow[]`:

```typescript
const rows = result.mappings.map((m) =>
  makeRichRow(
    {
      field:     m.field,
      type:      m.type,
      row_key:   m.row_key,
      extra_key: m.extra_key,
      rules:     m.rules ?? [],
      delimiter: m.delimiter,
    },
    "suggestion",    // baseline
    undefined,       // forcedState
    undefined,       // importedValue
    undefined,       // openOnMount
    m.options        // formQuestion options (for alias editor)
      ? { options: m.options, grid_rows: m.grid_rows, grid_columns: m.grid_columns }
      : undefined,
    m.google_type,   // googleType — for hard lock
  )
)
```

Remove the old `handleFetchHeaders` logic that merged `result.headers`, `result.suggestions`, and `result.form_questions` separately.

**`fetchHeaders` call site** must pass `sheet_type` and `form_url`:
```typescript
const result = await sheetsApi.headers(
  tournamentId, sheetUrl, sheetName, sheetType, formUrl || undefined
)
```

### `frontend/app/dashboard/[tournamentId]/sheets/[configId]/edit/page.tsx`

Same changes as `new/page.tsx`:
- `fetchHeaders` passes `sheet_type` and `form_url`
- Map `result.mappings` directly, no client merging
- Pass `googleType` through `makeRichRow`

---

## API Endpoints

```
GET    /health

# Auth
POST   /auth/login/, /auth/logout/
GET    /auth/me/
POST   /auth/register/                                      # admin only

# Tournaments
GET    /tournaments/                                        # admin only
GET    /tournaments/me/
POST   /tournaments/
GET/PATCH/DELETE /tournaments/{id}/

# Events (nested under tournament)
GET/POST /tournaments/{id}/events/
GET/PATCH/DELETE /tournaments/{id}/events/{event_id}/

# Memberships
GET    /tournaments/{id}/memberships/                       # returns MembershipReadWithUser (user inline)
POST   /tournaments/{id}/memberships/
GET/PATCH/DELETE /tournaments/{id}/memberships/{membership_id}/

# Users (admin-only global)
GET    /users/
GET    /users/{id}/, /users/by-email/{email}/
PATCH  /users/{id}/, DELETE /users/{id}/
GET    /tournaments/{id}/users/{user_id}/                   # manage_volunteers+

# Sheets
POST   /tournaments/{id}/sheets/validate/
POST   /tournaments/{id}/sheets/headers/                   # body: {sheet_url, sheet_name, sheet_type, form_url?}
                                                           # returns SheetHeadersResponse with flat mappings list
POST   /tournaments/{id}/sheets/configs/validate-mappings/ # 200 {ok, errors, warnings} — no DB write
GET    /tournaments/{id}/sheets/configs/
POST   /tournaments/{id}/sheets/configs/                   # → SheetConfigReadWithWarnings
GET    /tournaments/{id}/sheets/configs/{config_id}/
PATCH  /tournaments/{id}/sheets/configs/{config_id}/       # → SheetConfigReadWithWarnings
DELETE /tournaments/{id}/sheets/configs/{config_id}/
POST   /tournaments/{id}/sheets/configs/{config_id}/sync/

# Planned (not yet built)
POST   /tournaments/{id}/memberships/delete-by-emails/
GET    /tournaments/{id}/sheets/configs/{config_id}/rows/
```

---

## Test Infrastructure

**conftest.py fixtures:** `db` (in-memory SQLite, FK ON, rollback per test), `mock_sheets_service`, `mock_forms_service`, `client`, `admin_user`, `td_user`, `other_user`, `td_tournament`, `other_tournament`, `login(client, email, password)`

- `mock_sheets_service.get_headers` returns `SheetHeadersResponse` with flat `mappings: list[MappedHeader]`
- `mock_forms_service.get_form_questions` returns plain `list[dict]` with `google_type` + `nexus_type` keys (not Pydantic models)

**CI:** GitHub Actions runs `pytest` on every push. Workflow sets `APP_ENV=test` and leaves `DATABASE_URL` and `API_KEY` blank — `session.py` skips engine init when `DATABASE_URL` is empty, and `security.py` bypasses API key checks when `APP_ENV` is `"development"` or `"test"` and `API_KEY` is blank.

---

## Development Phases

- [x] Phase 1–6 — Backend models, sync service, deploy
- [x] **Phase 7e** — Sheets UI (wizard, view, edit, mapping table, import/export)
- [x] **Phase 8** — Membership-based permissions
- [x] **Phase 9** — Preview environments
- [x] **Issue #4** — Membership list inline user data (`joinedload`)
- [x] **feat/sheet-config-parse-rules** — Parse rules backend + frontend
- [x] **feat/sheet-config-parse-rules-ux** — Rule editor UX (accordion, Select component, diff tooltip, import summary)
- [x] **feat/volunteers-display** — Tags, availability rows, extra_data widths
- [x] **Validation UX overhaul** — validate-first save flow, useSheetValidation hook, SheetMappingValidationModals, ValidationIssue.header as list, ParseRule model_validator removed
- [x] **GitHub Actions CI** — pytest workflow on every push
- [x] **feature/backend-forms-api-mapping** — FormsService, FormQuestion models, sheet_type volunteers/events, form_url wizard step, alias editor backend
- [x] **feature/backend-headers-refactor** — flat MappedHeader response, google_type lock, dedup, parse_time_range canonical action
- [x] **fix/sync-parse-time-range** — `_apply_rules` now checks `action in PARSE_TIME_RANGE_ACTIONS` (was `== "parse_availability"` only, silently skipping `parse_time_range`); sync route arg order fixed (`config, db, svc`); `is_active` guard added to sync endpoint; full test suite alignment
- [ ] **feature/frontend-headers-refactor** — Update frontend for new SheetHeadersResponse shape (see Frontend Work section above)
- [ ] **Phase 7f** — Events + volunteers tables (proper, not temp)
- [ ] **Phase 7g** — Assignment dashboard

---

## Branch Strategy

Backend and frontend on **separate feature branches**, PRed independently.
```
feature/backend-*   →  staging  →  main
feature/frontend-*  →  staging  →  main
```
When a backend bug is found during frontend work: document here + open GitHub issue.

---

## Known Issues / Future Work
- **[GitHub issue] `DateTime` without timezone** — datetimes display as local time. Temp: `fmtDateTime` appends `Z`. Fix: `DateTime(timezone=True)` + migration + remove frontend normalization.
- **[GitHub issue] Bulk membership delete + raw sheet row endpoints** — temp implementations in `api.ts` need real routes.
- **[GitHub issue] Add `sheet_config_ids` to Membership** — provenance tracking.
- **`SplitButton`** — unused, can be removed.

---

## Deployment

### Backend (Railway)
- Root directory: `backend`, start command via `Procfile`
- Migrations: `$env:DATABASE_URL="<public_url>"; python -m alembic upgrade head` (PowerShell)
- Secrets: `APP_ENV`, `API_KEY`, `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`
- Preview DB: `postgresql://postgres:...@yamanote.proxy.rlwy.net:31907/railway`
- Prod DB: `postgresql://postgres:...@interchange.proxy.rlwy.net:19714/railway`

### Frontend (Vercel)
- Root directory: `frontend`, server-side env vars: `API_URL`, `API_KEY`
- Every branch push auto-generates a preview deployment

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

**Parse rule patterns:**
- `Volunteering Role Preference` → `multi_select`, two `contains` + `replace` rules stripping description suffixes
- `If interested in event volunteering...` → `multi_select`, `delimiter: ";"`, two regex rules: replace `\) ?, ?` with `;` then strip ` \([^)]+\)`
- `If you are interested in general volunteer...` → `multi_select`, `contains` + `replace` per option
- All 6 availability rows → `matrix_row` + `parse_time_range` rule (condition: `always`)
- `Have you competed...` + `If you have competed...` → both map to `extra_data` — backend dedup now ensures the second one falls back to `ignore` automatically

---

## Frontend Design System

### Fonts
- `--font-serif` → Georgia — h1, h2, page titles, wordmarks
- `--font-sans` → Geist — UI labels, buttons, nav, badges
- `--font-mono` → Geist Mono — body text, inputs, data values

### Colors
- `--color-bg`: `#F7F7F5` | `--color-surface`: `#FFFFFF`
- `--color-accent`: `#0A0A0A` | `--color-accent-subtle`: `#F0F0EC`
- `--color-danger`: `#E53E3E` | `--color-success`: `#22C55E` | `--color-warning`: `#EAB308`
- `--color-border`: `#E2E2DE` | `--color-border-strong`: `#C8C8C2`
- `--color-text-primary`: `#0A0A0A` | `--color-text-secondary`: `#6B6B65` | `--color-text-tertiary`: `#9B9B93`
- Row state colors: changed `#FFF7ED`/`#FDBA74` (orange-amber), warning `#FFFBEB`/`#FDE047` (yellow), error `#FFF5F5`/`#FCA5A5`, new `#F0FDF4`/`#86EFAC`

### Component conventions
- **Always use `Button`** — never raw `<button>`
- **Always use `Select`** — never raw `<select>`. `size="sm"` for table rows and rule editor.
- **Always use `Input`** — `font` prop: `"sans"` (default) | `"mono"` | `"serif"`. Surface background.
- **Always use `Banner`** for inline feedback
- **Always use `PageHeader`** for page title + subtitle + action
- **Always use `EmptyState`** for empty list states
- **All SVG icons in `Icons.tsx`** — never define inline
- **`SheetMappingValidationModals`** — one file, two exports. Use for all sheet save validation feedback.
- **`useSheetValidation`** — use on any page that saves sheet configs.

### Dashboard layout
- **`/dashboard`** — tournament card grid, `Topbar showWordmark showAvatar`
- **`/dashboard/[id]/*`** — sidebar + `Topbar showDropdown showAvatar`
- Sidebar: 52px collapsed / 192px expanded, in normal flow (pushes content)
- All pages use `width: 100%`