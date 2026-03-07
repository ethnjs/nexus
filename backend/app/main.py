from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.db.init_db import init_db
from app.api.routes import tournaments, sheets

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run startup tasks before the app begins serving requests."""
    # Skip DB init when running under pytest — conftest handles table creation
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

# Register routers
app.include_router(tournaments.router, prefix="/api/v1")
app.include_router(sheets.router, prefix="/api/v1")


@app.get("/health", tags=["meta"])
def health_check():
    return {"status": "ok", "env": settings.app_env}