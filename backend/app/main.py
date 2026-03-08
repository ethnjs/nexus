from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.security import verify_api_key
from app.db.init_db import init_db
from app.api.routes import tournaments, sheets, events, users, memberships
from app.api.routes import auth  # new

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run startup tasks before the app begins serving requests."""
    import os
    if os.environ.get("PYTEST_CURRENT_TEST") is None:
        init_db()
    yield


app = FastAPI(
    title="Nexus",
    description="Backend API for Nexus — Science Olympiad tournament management.",
    version="0.1.0-beta",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS
# In production: Vercel frontend origin must be listed explicitly.
# allow_credentials=True is required for cookies to be sent cross-origin.
# The frontend must use `credentials: "include"` on all fetch calls.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        # Add Vercel production URL here when frontend is deployed, e.g.:
        # "https://nexus-app.vercel.app",
    ],
    allow_credentials=True,   # required for cookies
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# Auth routes are public (no API key required) — login must be reachable
# without credentials. All other routes still require X-API-Key for direct
# API / Swagger access.
# ---------------------------------------------------------------------------
api_key_dependency = Depends(verify_api_key)

# Auth — no API key dependency (login must be publicly reachable)
app.include_router(auth.router, prefix="/api/v1")

# All other routers — still protected by API key for direct access
app.include_router(tournaments.router, prefix="/api/v1", dependencies=[api_key_dependency])
app.include_router(sheets.router,      prefix="/api/v1", dependencies=[api_key_dependency])
app.include_router(events.router,      prefix="/api/v1", dependencies=[api_key_dependency])
app.include_router(users.router,       prefix="/api/v1", dependencies=[api_key_dependency])
app.include_router(memberships.router, prefix="/api/v1", dependencies=[api_key_dependency])


@app.get("/health", tags=["meta"])
def health_check():
    return {"status": "ok", "env": settings.app_env}