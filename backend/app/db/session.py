from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings

settings = get_settings()

# Tests build their own engine from TEST_DATABASE_URL, so DATABASE_URL may be blank.
if settings.database_url:
    # SQLite needs this pragma for foreign key enforcement
    # PostgreSQL enforces FKs by default, so this is a no-op there
    connect_args = {}
    if settings.database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    engine = create_engine(
        settings.database_url,
        connect_args=connect_args,
        echo=settings.sql_echo,  # opt-in via SQL_ECHO=true
        pool_pre_ping=True,  # Railway's proxy drops idle connections; ping before reuse
        pool_recycle=300,  # recycle before Railway's idle timeout kills the socket
    )

    # Enable FK constraints on every SQLite connection
    if settings.database_url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
else:
    engine = None

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """All SQLAlchemy models inherit from this."""

    pass


def get_db():
    """
    FastAPI dependency — yields a DB session per request, always closes it.

    Usage in a route:
        def my_route(db: Session = Depends(get_db)):
            ...
    """
    if engine is None:
        raise RuntimeError("DATABASE_URL is not set")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
