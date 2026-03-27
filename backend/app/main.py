from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from scalar_fastapi import get_scalar_api_reference

from app.core.config import get_settings
from app.core.security import verify_api_key
from app.db.init_db import init_db, seed_dev_data
from app.api.routes import tournaments, sheets, events, users, memberships
from app.api.routes import auth

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    import os
    if os.environ.get("PYTEST_CURRENT_TEST") is None:
        init_db()
        if get_settings().app_env in ("development", "preview"):
            from app.db.session import SessionLocal
            with SessionLocal() as db:
                seed_dev_data(db)
    yield


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
app.include_router(auth.router,        prefix="", dependencies=[api_key_dependency])
app.include_router(tournaments.router, prefix="", dependencies=[api_key_dependency])
app.include_router(events.router,      prefix="", dependencies=[api_key_dependency])
app.include_router(memberships.router, prefix="", dependencies=[api_key_dependency])
app.include_router(sheets.router,      prefix="", dependencies=[api_key_dependency])
app.include_router(users.router,       prefix="", dependencies=[api_key_dependency])


@app.get("/health", tags=["meta"])
def health_check():
    return {"status": "ok", "env": settings.app_env}


@app.get("/reference", include_in_schema=False)
async def scalar_reference():
    return get_scalar_api_reference(
        openapi_url="/openapi.json",
        title="NEXUS API Reference",
    )