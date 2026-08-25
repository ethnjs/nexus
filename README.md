# NEXUS

A platform for Science Olympiad tournament directors and alumni chapters to run volunteer logistics without living in spreadsheets.

**Live:** [nexus.ethanshih.com](https://nexus.ethanshih.com)

## The problem

Running a Science Olympiad tournament means recruiting, organizing, and scheduling dozens to hundreds of volunteers — and the default tooling for that is a pile of Google Forms feeding a pile of Google Sheets.

That falls apart fast:

- **Every tournament starts from zero.** A volunteer who worked last year's tournament fills out the exact same interest form again this year, because nothing about them — availability, experience, contact info — carries over. Every alumni chapter maintains its own copy of "who our people are," disconnected from every tournament those people actually work.
- **The sheet is the database, and it shows.** Volunteer info, event assignments, availability, and preferences end up spread across multiple tabs and multiple sheets per tournament, glued together with formulas someone half-remembers how to fix. There's no single source of truth for who's assigned where.
- **Nothing updates safely.** Once a form's out and people start responding, changing a question is risky — did that break the sheet formula reading column J? Did someone's already-submitted answer become nonsense? Directors either freeze the form entirely or edit it and hope.
- **Data goes stale invisibly.** A shift gets rescheduled, an event gets renamed, a volunteer's availability changes — and there's no mechanism connecting the sheet back to reality. Someone finds out on tournament day.
- **No real access control.** A shared sheet is either editable by everyone with the link or locked down entirely. There's no notion of "this person manages volunteers but not events," so permissions end up being social convention, not something the system enforces.

None of this is a Science-Olympiad-specific problem — it's what happens when an org's operational data lives in spreadsheets stitched together by forms. NEXUS exists to replace that stack with an actual system.

---

## What NEXUS does

**Volunteer profiles.** A volunteer's info — contact details, experience, availability — lives on their account, not in a specific tournament's response sheet. It's filled out once and carries forward: the next tournament they join, or the next season their chapter runs, starts from what's already known about them instead of another blank form.

**Volunteer assignment.** Tournament directors manage events, shifts, and roles, and assign volunteers against real structural data — not a spreadsheet of names and guesses. Assignments, availability, and preferences live in one relational system, so who's working what is always answerable with a query, not a hunt across tabs.

**Custom forms.** Tournaments and chapters build their own forms directly in NEXUS — branching questions, structured answer types, per-event and per-shift options pulled live from the tournament's own data — instead of hand-wiring a Google Form to a Sheet. Editing a live form doesn't silently corrupt what's already been submitted: NEXUS understands its own form/response/answer relationship well enough to change safely underneath real data.

Underneath all three: a real membership and role model (a volunteer can belong to multiple tournaments and chapters at once, each with its own permissions), so access to any of this is something the system enforces, not something everyone just has to agree to respect.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, FastAPI, SQLAlchemy, Alembic |
| Database | PostgreSQL (dev via Docker, prod via Railway) |
| Frontend | Next.js, React, TypeScript |
| Auth | JWT (httpOnly cookie) + API key |
| Hosting | Railway (backend), Vercel (frontend) |

---

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
