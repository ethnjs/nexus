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
- **Form builder.** Custom questions, branching, and presets for availability, event preference, lunch and track status, tied to your real events and shifts.- **Members directory.** Profiles, answers and assignments on one record, with a table view each person customizes.
- **Assignments board.** Put volunteers on events and shifts and see where the gaps are, using the availability and preferences they already gave.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, FastAPI, SQLAlchemy, Alembic |
| Database | PostgreSQL (dev via Docker, prod via Railway) |
| Frontend | Next.js, React, TypeScript |
| Auth | JWT (httpOnly cookie) + API key |
| Hosting | Railway (backend), Vercel (frontend) |

## Project Structure

```
nexus/
├── backend/        # FastAPI app
│   ├── app/
│   │   ├── api/routes/     # Auth, users, tournaments, chapters, forms, sheets
│   │   ├── core/           # Config, auth, permissions, tournament/form/chapter logic
│   │   ├── db/             # Session, migrations
│   │   ├── models/         # SQLAlchemy ORM models
│   │   ├── schemas/        # Pydantic schemas
│   │   └── services/       # Google Sheets, sync logic
│   ├── alembic/            # DB migrations
│   └── tests/              # Pytest test suite
└── frontend/       # Next.js app
    ├── app/                # Pages (dashboard, tournament/chapter views, forms)
    ├── components/         # UI + feature components
    └── lib/                # API client, auth + data hooks
```
