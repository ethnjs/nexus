from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from scalar_fastapi import get_scalar_api_reference

from app.core.config import get_settings
from app.core.security import verify_api_key
from app.db.init_db import init_db, seed_dev_data
from app.api.routes import (
    auth, events, join,
    sheets, users, user_experience, universities,
)
from app.api.routes import tournament as tournament_core
from app.api.routes.tournament import events as tournament_events
from app.api.routes.tournament import shifts as tournament_shifts
from app.api.routes.tournament import memberships as tournament_memberships
from app.api.routes.tournament import roles as tournament_roles
from app.api.routes.tournament import join_codes as tournament_join_codes
from app.api.routes.tournament import admin as tournament_admin
from app.api.routes.tournament import audit as tournament_audit
from app.api.routes.tournament import setup_checklist as tournament_setup_checklist
from app.api.routes import chapter as chapter_core
from app.api.routes.chapter import admin as chapter_admin
from app.api.routes.chapter import memberships as chapter_memberships
from app.api.routes.chapter import join_codes as chapter_join_codes

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    import os
    scheduler = None
    if os.environ.get("PYTEST_CURRENT_TEST") is None:
        from app.db.session import SessionLocal
        from app.db.seed_canon_events import seed_events_and_categories
        from app.db.seed_universities import seed_universities

        with SessionLocal() as db:
            seed_events_and_categories(db)  # always — dev + prod
            seed_universities(db)  # always — dev + prod

        if get_settings().app_env in ("development", "preview"):
            init_db()
            with SessionLocal() as db:
                seed_dev_data(db)

        from apscheduler.schedulers.background import BackgroundScheduler
        from app.core.tournament.scheduler import archive_ended_tournaments

        def _run_archive_job():
            with SessionLocal() as db:
                archive_ended_tournaments(db)

        scheduler = BackgroundScheduler()
        scheduler.add_job(_run_archive_job, "cron", hour=0, minute=5, id="archive_ended_tournaments")
        scheduler.start()

    yield

    if scheduler is not None:
        scheduler.shutdown(wait=False)


app = FastAPI(
    title="NEXUS",
    description="Backend API for NEXUS — Science Olympiad tournament management",
    version="0.2.0",
    lifespan=lifespan,
    redirect_slashes=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://nexus.ethanshih.com",
    ],
    allow_origin_regex=r"https://nexus-.*\.ethanshih\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_key_dependency = Depends(verify_api_key)

# All routes require API key — including auth (login, logout, register).
# In development with API_KEY unset, security.py skips the check automatically.
app.include_router(auth.router,                   prefix="", dependencies=[api_key_dependency])
app.include_router(join.router,                   prefix="", dependencies=[api_key_dependency])
app.include_router(events.router,                 prefix="", dependencies=[api_key_dependency])
app.include_router(tournament_core.router,               prefix="", dependencies=[api_key_dependency])
app.include_router(tournament_events.router,             prefix="", dependencies=[api_key_dependency])
app.include_router(tournament_shifts.router,               prefix="", dependencies=[api_key_dependency])
app.include_router(tournament_shifts.event_shifts_router,  prefix="", dependencies=[api_key_dependency])
app.include_router(tournament_memberships.router,        prefix="", dependencies=[api_key_dependency])
app.include_router(tournament_roles.router,               prefix="", dependencies=[api_key_dependency])
app.include_router(tournament_roles.membership_roles_router, prefix="", dependencies=[api_key_dependency])
app.include_router(tournament_join_codes.router,          prefix="", dependencies=[api_key_dependency])
app.include_router(tournament_admin.router,                prefix="", dependencies=[api_key_dependency])
app.include_router(tournament_audit.router,                prefix="", dependencies=[api_key_dependency])
app.include_router(tournament_setup_checklist.router,      prefix="", dependencies=[api_key_dependency])
app.include_router(sheets.router,                 prefix="", dependencies=[api_key_dependency])
app.include_router(users.router,                  prefix="", dependencies=[api_key_dependency])
app.include_router(user_experience.router,        prefix="", dependencies=[api_key_dependency])
app.include_router(universities.router,           prefix="", dependencies=[api_key_dependency])
app.include_router(chapter_core.router,           prefix="", dependencies=[api_key_dependency])
app.include_router(chapter_admin.router,          prefix="", dependencies=[api_key_dependency])
app.include_router(chapter_memberships.router,    prefix="", dependencies=[api_key_dependency])
app.include_router(chapter_join_codes.router,     prefix="", dependencies=[api_key_dependency])


@app.get("/health", tags=["meta"])
def health_check():
    return {"status": "ok", "env": settings.app_env}


@app.get("/reference", include_in_schema=False)
async def scalar_reference():
    return get_scalar_api_reference(
        openapi_url="/openapi.json",
        title="NEXUS API Reference",
    )