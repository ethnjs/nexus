# Frontend

Run from `frontend/`: `pnpm dev`, `pnpm build`, `pnpm check` (Biome lint and format check), `pnpm fix` (applies its formatting, import sorting and safe fixes), `pnpm format`, `pnpm lint:react` (React Compiler rules), `pnpm typecheck`. CI runs `check`, `lint:react` and `typecheck`; the pre-commit hook runs only Biome, on staged files.

Biome is the linter and formatter (`biome.jsonc`). ESLint runs only the React Compiler rules Biome lacks (`eslint.config.mjs`). Suppress a Biome rule with `// biome-ignore lint/<group>/<rule>: <reason>`; inside JSX children that has to be `{/* biome-ignore … */}`, since `//` there renders as text. Prefer fixing React Compiler findings to suppressing them: an `eslint-disable` for a `react-hooks` rule makes the compiler rules skip the whole component.

There's no test suite. UI changes are verified by using them in a browser against the local backend, so say so when you haven't. Judge performance on a production build (`pnpm build && pnpm start -p 3001`), not `next dev`.

## Talking to the backend

- `lib/api.ts` is the only API client. Its types mirror the backend's Pydantic response schemas, and endpoints are grouped into `*Api` objects (`tournamentsApi`, `formsApi`, …). A new backend route or response field means updating this file. Don't call `fetch()` elsewhere.
- Errors throw `ApiError` (`.status`, `.detail`); branch on `instanceof ApiError`.
- Requests go to `/api/proxy` (`app/api/proxy/[...path]/route.ts`), which adds the trailing slash, attaches `X-API-Key` on the server, and forwards to `API_URL` (default `http://localhost:8001`). Don't set `NEXT_PUBLIC_API_URL`.
- `proxy.ts` is Next.js middleware, not part of the API path. It sends signed-out visitors away from `/dashboard`, `/onboarding` and `/forms` using the `access_token` cookie, except a shared form link (`/forms/{id}/view`), which shows them a sign-in card.

## UI kit (`components/ui/`)

- Build with the kit (`Button`, `Input`, `Textarea`, `Dropdown`, `Combobox`, `Checkbox`, `Switch`, `ButtonGroup`, `Modal`, `ConfirmModal`, `Popover`, `Tooltip`, `Banner`, `PageHeader`, `EmptyState`, …) instead of raw HTML controls. Check the folder before writing a new primitive.
- Prop names are shared across the kit: `variant` for color scheme, `locked` for the app's read-only state (native `disabled` only where there's no separate locked concept), and `size` with the same heights everywhere (`xs` 26px, `sm` 28px, `md` 36px, `lg` 48px). New components follow the same names.
- Icons live in `Icons.tsx`; don't inline SVGs.

## Styling

- Components mostly use inline `style={{}}` objects with CSS variable tokens (`var(--color-accent)`) defined in the `@theme` block of `app/globals.css`. Add a `.module.css` file only for what inline styles can't express: hover and focus states, keyframes, media queries. Tailwind utilities appear in a few layout spots; match the file you're editing and don't convert components between styles.
- Use tokens, not hex values.
- `--color-accent` is near-black. Don't use it for hover, drag-over or highlight borders; use `--color-border-strong` with an `--color-accent-subtle` fill.
- Fonts: serif (Georgia) for titles, sans (Geist) for UI, mono (Geist Mono) for data and inputs.

## Structure

- `app/` routes:
  - `(auth)/` holds the signed-out flows.
  - `dashboard/tournaments/[id]/<tab>` is the staff app: `overview`, `members`, `events`, `shifts`, `forms`, `sheets`, `assignments`, and `settings/{general,roles,invites,audit-log}`.
  - `dashboard/admin/` is the site admin area.
  - `forms/[formId]/{edit,preview,view,responses}` holds the form builder and respondent views.
  - `tournaments/[id]/onboarding`, `join`, `profile/[id]` and `settings/` are member-facing.
- `components/` holds the UI kit and feature folders (`tournament/`, `forms/`, `profile/`, …).
- `lib/` holds the API client, hooks and helpers, with feature folders `forms/`, `assignments/`, `roles/` and `exports/`.
- Shared state is React Context through `useX` hook + `XProvider` pairs in `lib/` (`useAuth`, `useTournament`, `useMyMembership`, …). There's no Redux, Zustand or react-query.
- Import from the `frontend/` root with the `@/` alias.
