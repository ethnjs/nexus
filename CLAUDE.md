# NEXUS

NEXUS replaces the Google Forms → Sheets workflow that Science Olympiad tournament directors (TDs) and alumni chapters use to run volunteers. It covers volunteer profiles, tournaments with tracks, events and shifts, roles and permissions, a form builder whose answers feed structured tables, and an assignments board.

- `backend/`: FastAPI, SQLAlchemy 2, Alembic, Postgres 16, Python 3.13 managed with uv. Deployed on Railway. See `backend/CLAUDE.md`.
- `frontend/`: Next.js 16 App Router, React 19, TypeScript, Tailwind v4, pnpm. Deployed on Vercel. See `frontend/CLAUDE.md`.
- `docs/`: public user docs and release notes, synced to the docs site. Not developer docs.
- `backend/docs/`: developer design notes for the subsystems that are hard to infer from code. Path-scoped rules in `.claude/rules/` say when to read them.

Setup, the release process and PR conventions for humans are in `CONTRIBUTING.md`.

## Running things

- Backend dev server, from `backend/`: `uv run uvicorn app.main:app --reload --port 8001`. Dev startup migrates and seeds `admin@nexus.dev` / `admin1234` and `user1@nexus.dev`..`user15@nexus.dev` / `user1234`. The frontend proxy expects port 8001.
- Frontend, from `frontend/`: `pnpm dev`.
- Postgres runs in Docker (`docker-compose up -d` in `backend/`). Each git worktree gets its own database through the post-checkout hook (`scripts/setup-worktree-db.sh`).

## Running tests

Backend tests are slow: one API test file takes about 100 seconds, and the full suite about 15 minutes. A whole directory like `tests/api/tournament/` takes nearly as long as the full suite. CI runs Ruff and the full suite on every backend PR.

- **Scope:** run the test files your change touches. In a multi-step task, write tests as you go and run them once the steps are done, not after each step. Run the full suite, a whole directory, or `tests/test_migrations.py` (which builds a scratch database from every migration) only once, at the end, as a final check.
- **Run in the background** (`run_in_background: true` on the Bash/PowerShell call) for anything longer than re-running a single test while debugging, and keep working meanwhile.
- **Exact command:** `cd backend && uv run python -u -m pytest <paths> -q`. A background shell starts at the repo root, so the `cd` is required. `-u` keeps output unbuffered. Never pipe through `tail` or `head`: the pipe holds all output until pytest exits, so a live run looks identical to a dead one.
- **One pytest run at a time.** Concurrent runs share the test database and stall each other. Before starting one, check that no other pytest process is running.
- **Wait for the completion notification** instead of polling the output. Check progress once if the user asks. Never report tests as passing before the results arrive.

## Workflow

- Branches are `feat/`, `fix/`, `refactor/` or `docs/` plus a short description. Every change reaches `main` through a PR reviewed by the other maintainer; never commit to `main`.
- Commits are one-line Conventional Commits with no body: `type(scope): summary`, with `!` for breaking changes. semantic-release picks the version from the type (`feat` minor, `fix` and `perf` patch, everything else none), so choose the type by the effect on users. Don't repeat the scope in the summary.
- PR descriptions follow `.github/pull_request_template.md`: one line per bullet and no hard-wrapped lines. Write them for a reviewer who wasn't in your session and is skimming:
  - Say what changed and why in plain terms, as a standalone account of the PR.
  - Don't refer to the conversation ("as discussed", "the approach we picked", "option B"), to intermediate attempts, or to your own process.
  - Be specific. Name the routes, models, columns, functions and components that changed so the reviewer knows where to look, and say what changed about each. An identifier alone tells the reviewer nothing.
  - The same applies to commit messages and issue bodies.
- A SQLAlchemy model change ships with its Alembic migration in the same PR.
- Add backend dependencies with `uv add <pkg>` (or `uv add --dev`), with no version, and upgrade with `uv lock --upgrade-package <pkg>`. Never hand-edit versions in `pyproject.toml` or `uv.lock`. On the frontend, use `pnpm add`.

## Writing code

- **Match the surrounding code** (naming, structure, idioms) over general preference. Keep a change to what the task needs. Don't refactor neighboring code unless asked; mention it instead.
- **Look for what exists before building.** Search for an existing route, query parameter, helper, hook or UI component before adding one. Extract shared code only when there's a second real caller, not in anticipation.
- **Names describe what a thing is now**, not its history. When renaming a prop or concept, rename it consistently across siblings (for example, across the UI kit).
- **Comments are rare.** Write one only when it tells the reader something the code can't: a non-obvious invariant, a constraint from outside the code, or why the obvious approach is wrong. Keep it to a line or two. Don't narrate what the code does, restate names or types, or record history ("changed from X", "fix for #12"); that belongs in the commit or PR.
- **Leave touched files cleaner.** In any file you change, delete or shorten comments that fail the rule above, in the same PR. Existing comments are often long, and some are stale; when one contradicts the code, trust the code and fix the comment.
- **Docstrings** follow the same bar. Add one when a function's name and signature don't convey its contract (a side effect such as committing, sending email or deleting rows, a precondition, or a surprising return), usually in one line. Don't add docstrings for uniformity. FastAPI publishes a route handler's docstring as that endpoint's description in the public API reference, so write it for API consumers or leave it out.
- **Verify before claiming.** Confirm root causes and library behavior by reading the code or reproducing, and say so when something is an unverified theory.
