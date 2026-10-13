# NEXUS

A platform for Science Olympiad tournament directors and alumni chapters to run volunteer logistics without living in spreadsheets.

**Live:** [nexus.socalscioly.org](https://nexus.socalscioly.org)

## The problem

A Science Olympiad tournament needs dozens to hundreds of volunteers, and most are managed with Google Forms feeding Google Sheets. That breaks down quickly:

- **Every tournament starts from zero.** Volunteers retype the same details into every tournament's form.
- **Data is scattered.** Sign-ups, availability, assignments and lunch counts live in separate tabs and sheets, and nobody's sure which copy is current.

NEXUS replaces the forms-and-sheets setup with one system built around the people who sign up.

## What NEXUS does

- **A profile that follows you.** Volunteers fill in their details once, and every tournament they join gets them.
- **Tournaments in minutes.** Anyone can create one with a name, level, state, date and location.
- **Roles and permissions.** Define roles per tournament that control what each person can see and change.
- **Tracks.** Keep competition days and prep work like test writing under one tournament, with one record per member.
- **Events and shifts.** Pick events from the official season list, add custom ones, and lay out the shifts volunteers are assigned to.
- **Form builder.** Custom questions, branching, and presets for availability, event preference, lunch and track status, tied to your real events and shifts.
- **Members directory.** Profiles, answers and assignments on one record, with a table view each person customizes.
- **Assignments board.** Put volunteers on events and shifts and see where the gaps are, using the availability and preferences they already gave.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.13, FastAPI, SQLAlchemy 2, Alembic, uv |
| Database | PostgreSQL 16 (Docker locally, Railway in production) |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Auth | Session cookie backed by a database session table, plus an API key between frontend and backend |
| Hosting | Railway (backend), Vercel (frontend) |

## Project structure

```
nexus/
├── backend/            # FastAPI app
│   ├── app/
│   │   ├── api/routes/ # HTTP routes, with tournament/ and chapter/ subpackages
│   │   ├── core/       # Business logic: auth, permissions, tournaments, forms
│   │   ├── db/         # Session, startup seeding, dev scripts
│   │   ├── models/     # SQLAlchemy models
│   │   ├── schemas/    # Pydantic request and response models
│   │   └── services/   # Google Sheets/Forms, sheet sync, email
│   ├── alembic/        # Migrations
│   ├── docs/           # Design notes for the trickier subsystems
│   └── tests/          # pytest suite
├── frontend/           # Next.js app
│   ├── app/            # Routes
│   ├── components/     # UI kit (components/ui) and feature components
│   └── lib/            # API client, hooks, shared helpers
└── docs/               # User-facing docs and release notes, synced to the docs site
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to run it locally.
