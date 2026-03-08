from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.security import verify_api_key
from app.db.init_db import init_db
from app.api.routes import tournaments, sheets, events, users, memberships

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

# CORS — allow the Next.js frontend (adjust origins for production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",   # Next.js dev server
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global API key dependency — applied per-router so /health stays public
api_key_dependency = Depends(verify_api_key)

app.include_router(tournaments.router, prefix="/api/v1", dependencies=[api_key_dependency])
app.include_router(sheets.router,      prefix="/api/v1", dependencies=[api_key_dependency])
app.include_router(events.router,      prefix="/api/v1", dependencies=[api_key_dependency])
app.include_router(users.router,       prefix="/api/v1", dependencies=[api_key_dependency])
app.include_router(memberships.router, prefix="/api/v1", dependencies=[api_key_dependency])


@app.get("/health", tags=["meta"])  # No dependency — intentionally public
def health_check():
    return {"status": "ok", "env": settings.app_env}